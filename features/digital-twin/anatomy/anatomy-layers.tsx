"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Material, type Object3D, Quaternion, Vector3 } from "three";

import { fitAtlasToScan } from "@/packages/anatomy/fit";
import { partsFor, type Highlight } from "@/packages/anatomy/highlight";
import {
  applyMask,
  ATLAS_LAYER_IDS,
  dampDepth,
  layerMix,
  partShown,
  type AtlasLayerId,
} from "@/packages/anatomy/layers";
import { ATLASES, atlasApiUrl, type AtlasId } from "@/packages/anatomy/manifest";
import { type OrganSystem } from "@/packages/anatomy/systems";

import { disposeObject3D } from "../dispose-object";
import { type Picked } from "../environment/pick-part";
import { PickSurface } from "../environment/pick-surface";
import { LiveConditioning, type LiveStatus } from "../live/live-conditioning";
import { type LiveVitals } from "../live/live-rates";
import { type AnatomyLoad } from "./anatomy-state";
import {
  applyMixToUniforms,
  attachLayerFade,
  blendModeFor,
  createLayerUniforms,
  setBlendMode,
  setHighlighted,
  type LayerUniforms,
} from "./layer-material";
import { loadAtlasGltf } from "./load-atlas";
import { prepareAtlas, type PreparedAtlas } from "./prepare-atlas";
import { collectScanMaterials, readScanFrame } from "./scan-frame";

/** Dev-only nudge when a layer combination gets heavy for a low-power GPU. */
const TRIANGLE_WARNING = 2_500_000;

type ScanSurface = Readonly<{ material: Material; uniforms: LayerUniforms }>;

const NO_PARTS: PreparedAtlas["parts"] = [];
const NO_GROUPS: PreparedAtlas["groups"] = [];
const ignorePick = (): void => undefined;

/**
 * The reference-anatomy layers inside the Body twin canvas. Loads the atlas the
 * first time it is asked for, fits it to the scan, and every frame eases the
 * depth toward the slider and writes the resulting fade into shared uniforms.
 * Visibility and blend mode are set here so fully faded layers cost nothing.
 */
export const AnatomyLayers = ({
  scanRoot,
  statureM,
  atlasId,
  requested,
  retry,
  targetDepth,
  layers,
  hiddenSystems,
  highlight,
  reducedMotion,
  onLoad,
  onPick,
  liveVitals,
}: Readonly<{
  scanRoot: Object3D | null;
  /** The scan's measured stature in metres, when it has one; the fit prefers it. */
  statureM: number | null;
  atlasId: AtlasId;
  requested: boolean;
  retry: number;
  targetDepth: number;
  layers: Readonly<Record<AtlasLayerId, boolean>>;
  hiddenSystems: readonly OrganSystem[];
  highlight: Highlight | null;
  reducedMotion: boolean;
  onLoad: (load: AnatomyLoad) => void;
  /** Picking is on only in the environment; inline it stays off. */
  onPick?: (picked: Picked | null) => void;
  /** Live vitals (G4): what drives the heartbeat, breathing and HRV glow. */
  liveVitals?: Readonly<{
    enabled: boolean;
    vitals: LiveVitals;
    onStatus: (status: LiveStatus) => void;
  }>;
}>) => {
  const invalidate = useThree((state) => state.invalidate);
  // State renders the atlas; the refs are what the frame loop mutates, since
  // three.js objects are configured in place every frame.
  const [prepared, setPrepared] = useState<PreparedAtlas | null>(null);
  const preparedRef = useRef<PreparedAtlas | null>(null);
  const scanSurfacesRef = useRef<readonly ScanSurface[]>([]);
  const fitOkRef = useRef(false);
  const depthRef = useRef(0);
  const live = useRef({ targetDepth, layers, hiddenSystems, reducedMotion });
  useEffect(() => {
    live.current = { targetDepth, layers, hiddenSystems, reducedMotion };
  });

  useEffect(() => {
    if (!requested) return;
    let cancelled = false;
    let loaded: PreparedAtlas | null = null;
    let lastPercent = -1;
    onLoad({ kind: "loading", percent: null });
    loadAtlasGltf(atlasApiUrl(atlasId), (fraction) => {
      const percent = fraction === null ? null : Math.round(fraction * 100);
      if (cancelled || percent === lastPercent) return;
      lastPercent = percent ?? -1;
      onLoad({ kind: "loading", percent });
    })
      .then((gltf) => {
        if (cancelled) {
          disposeObject3D(gltf.scene);
          return;
        }
        let ready: PreparedAtlas;
        try {
          ready = prepareAtlas(gltf.scene, ATLASES[atlasId]);
        } catch {
          disposeObject3D(gltf.scene);
          onLoad({ kind: "error" });
          return;
        }
        if (cancelled) {
          disposeObject3D(ready.root);
          return;
        }
        loaded = ready;
        preparedRef.current = ready;
        setPrepared(ready);
      })
      .catch(() => {
        if (!cancelled) onLoad({ kind: "error" });
      });
    return () => {
      cancelled = true;
      preparedRef.current = null;
      setPrepared(null);
      if (loaded) {
        loaded.root.removeFromParent();
        disposeObject3D(loaded.root);
      }
    };
  }, [requested, atlasId, retry, onLoad]);

  useEffect(() => {
    if (!scanRoot || !requested) return;
    const surfaces = collectScanMaterials(scanRoot).flatMap((material) => {
      const uniforms = attachLayerFade(material, createLayerUniforms(0.06));
      return uniforms ? [{ material, uniforms }] : [];
    });
    scanSurfacesRef.current = surfaces;
    invalidate();
    return () => {
      scanSurfacesRef.current = [];
      for (const surface of surfaces) {
        applyMixToUniforms(surface.uniforms, { alpha: 1, fade: 0, visible: true });
        setBlendMode(surface.material, "solid");
      }
    };
  }, [scanRoot, requested, invalidate]);

  const fit = useMemo(() => {
    if (!prepared || !scanRoot) return null;
    const entry = ATLASES[atlasId];
    return fitAtlasToScan(
      { box: prepared.box, hipAnchor: entry.hipAnchor, mirrorX: entry.mirrorX },
      readScanFrame(scanRoot, statureM),
    );
  }, [prepared, scanRoot, statureM, atlasId]);

  const transform = useMemo(() => {
    if (!fit?.ok) return null;
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    fit.matrix.decompose(position, quaternion, scale);
    return { position, quaternion, scale };
  }, [fit]);

  useEffect(() => {
    fitOkRef.current = fit?.ok === true;
    if (!prepared || !fit) return;
    onLoad({
      kind: "ready",
      presentLayers: [...prepared.presentLayers],
      systems: prepared.systems,
      partSystems: prepared.partSystems,
      groups: prepared.groups,
      parts: prepared.views,
      anchor: fit.anchor,
      fitOk: fit.ok,
    });
    if (process.env.NODE_ENV === "development" && prepared.triangles > TRIANGLE_WARNING) {
      console.warn(
        `[anatomy] ${Math.round(prepared.triangles / 1000)}k atlas triangles; at most three layers draw at once.`,
      );
    }
    invalidate();
  }, [prepared, fit, onLoad, invalidate]);

  // The glow is per material and set only when the highlight or the atlas
  // changes; the frame loop never touches it.
  useEffect(() => {
    if (!prepared) return;
    const lit = new Set(highlight ? partsFor(highlight, prepared.parts) : []);
    for (const part of prepared.parts) {
      setHighlighted(part.mesh.material as Material, lit.has(part));
    }
    invalidate();
    return () => {
      for (const part of prepared.parts) {
        setHighlighted(part.mesh.material as Material, false);
      }
    };
  }, [prepared, highlight, invalidate]);

  // Frames render on demand: kick one whenever an input changes.
  useEffect(() => {
    invalidate();
  }, [targetDepth, layers, hiddenSystems, invalidate]);

  useFrame((_, delta) => {
    const {
      targetDepth: wanted,
      layers: shown,
      hiddenSystems: hidden,
      reducedMotion: reduced,
    } = live.current;
    const atlas = preparedRef.current;
    const ready = atlas !== null && fitOkRef.current;
    const next = dampDepth(depthRef.current, ready ? wanted : 0, delta, reduced);
    const moving = next !== depthRef.current;
    depthRef.current = next;

    const scanMix = layerMix("scan", next);
    for (const surface of scanSurfacesRef.current) {
      applyMixToUniforms(surface.uniforms, scanMix);
      setBlendMode(surface.material, blendModeFor(scanMix, "scan"));
    }

    if (atlas) {
      for (const layer of ATLAS_LAYER_IDS) {
        applyMixToUniforms(atlas.uniforms[layer], layerMix(layer, next));
      }
      for (const part of atlas.parts) {
        const mix = applyMask(layerMix(part.layer, next), partShown(part, shown, hidden));
        Object.assign(part.mesh, { visible: mix.visible });
        setBlendMode(part.mesh.material as Material, blendModeFor(mix, "atlas"));
      }
    }
    if (moving) invalidate();
  });

  // Picks the body outline before any atlas is loaded, and atlas parts once one is.
  const readDepth = useCallback(() => depthRef.current, []);
  const ready = prepared !== null && transform !== null;
  const pick = (
    <PickSurface
      enabled={onPick !== undefined}
      scanRoot={scanRoot}
      parts={ready ? prepared.parts : NO_PARTS}
      groups={ready ? prepared.groups : NO_GROUPS}
      getDepth={readDepth}
      layers={layers}
      hiddenSystems={hiddenSystems}
      onPick={onPick ?? ignorePick}
    />
  );
  if (!ready) return pick;
  return (
    <>
      {pick}
      {liveVitals ? (
        <LiveConditioning
          enabled={liveVitals.enabled}
          vitals={liveVitals.vitals}
          scheme={ATLASES[atlasId].scheme}
          parts={prepared.parts}
          onStatus={liveVitals.onStatus}
        />
      ) : null}
      <group
        position={transform.position}
        quaternion={transform.quaternion}
        scale={transform.scale}
      >
        <primitive object={prepared.root} />
      </group>
    </>
  );
};

"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Color, type Material, type Object3D, Quaternion, Vector3 } from "three";

import { fitAtlasToScan, fitSkeletonToScan } from "@/packages/anatomy/fit";
import { partsFor, type Highlight } from "@/packages/anatomy/highlight";
import {
  applyMask,
  ATLAS_LAYER_IDS,
  dampDepth,
  partShown,
  viewMix,
  type AtlasLayerId,
} from "@/packages/anatomy/layers";
import { ATLASES, atlasApiUrl, type AtlasId } from "@/packages/anatomy/manifest";
import { type SkeletonAtlas } from "@/packages/anatomy/open-skeleton";
import { type OrganSystem } from "@/packages/anatomy/systems";

import { disposeObject3D } from "../dispose-object";
import { type Picked } from "../environment/pick-part";
import { PickSurface } from "../environment/pick-surface";
import { LiveConditioning, type LiveStatus } from "../live/live-conditioning";
import { type BeatPattern } from "../live/heart-cycle";
import { type LiveVitals } from "../live/live-rates";
import { useTwinPalette } from "../use-twin-palette";
import { type AnatomyLoad, type SkeletonLoad } from "./anatomy-state";
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
import { applyExplode, prepareSkeleton, type PreparedSkeleton } from "./prepare-skeleton";
import { SCAN_RENDER_ORDER, setLayerPasses, setScanRenderOrder } from "./depth-prepass";
import { collectScanMaterials, readScanFrame } from "./scan-frame";

/** Dev-only nudge when a layer combination gets heavy for a low-power GPU. */
const TRIANGLE_WARNING = 2_500_000;

type ScanSurface = Readonly<{ material: Material; uniforms: LayerUniforms }>;

/** The open-anatomy skeleton route; it answers 404 when none is configured. */
export const SKELETON_API_URL = "/api/anatomy/skeleton";

const NO_PARTS: PreparedAtlas["parts"] = [];
const NO_GROUPS: PreparedAtlas["groups"] = [];
const ignorePick = (): void => undefined;

/**
 * The reference-anatomy layers inside the Body twin canvas. Loads the atlas the
 * first time it is asked for, fits it to the scan, and every frame eases the
 * depth toward the slider and writes the resulting fade into shared uniforms.
 * Visibility and blend mode are set here so fully faded layers cost nothing.
 *
 * When an open-anatomy CT skeleton is configured and switched on, it is the
 * Skeleton layer: the atlas's own bones are hidden (so nothing the CT build
 * left out is drawn from another donor), and the CT bones fade, isolate and
 * spread apart on the same uniforms and passes as the atlas layers.
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
  isolate = null,
  explode = 0,
  skeleton = null,
  onSkeletonLoad,
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
  /** A tap on the body or a part, inline and in the environment; absent, nothing picks. */
  onPick?: (picked: Picked | null) => void;
  /** Live vitals (G4): what drives the heartbeat, breathing and HRV glow. */
  liveVitals?: Readonly<{
    enabled: boolean;
    vitals: LiveVitals;
    /** The heart chambers (#53): whether they beat, and on which beats. */
    chambers: Readonly<{ on: boolean; pattern: BeatPattern }>;
    onStatus: (status: LiveStatus) => void;
  }>;
  /** The layer shown alone and solid, if any. */
  isolate?: AtlasLayerId | null;
  /** How far the CT bones are spread apart, 0..1. */
  explode?: number;
  /** The configured CT skeleton's atlas.json, when it is on; null draws the atlas's bones. */
  skeleton?: SkeletonAtlas | null;
  onSkeletonLoad?: (load: SkeletonLoad) => void;
}>) => {
  const invalidate = useThree((state) => state.invalidate);
  const ring = useTwinPalette().ring;
  // State renders the atlas; the refs are what the frame loop mutates, since
  // three.js objects are configured in place every frame.
  const [prepared, setPrepared] = useState<PreparedAtlas | null>(null);
  const preparedRef = useRef<PreparedAtlas | null>(null);
  const scanSurfacesRef = useRef<readonly ScanSurface[]>([]);
  const fitOkRef = useRef(false);
  const depthRef = useRef(0);
  const [bones, setBones] = useState<PreparedSkeleton | null>(null);
  const bonesRef = useRef<PreparedSkeleton | null>(null);
  const bonesFitOkRef = useRef(false);
  const explodeRef = useRef(0);
  const live = useRef({
    targetDepth,
    layers,
    hiddenSystems,
    reducedMotion,
    isolate,
    explode,
  });
  useEffect(() => {
    live.current = {
      targetDepth,
      layers,
      hiddenSystems,
      reducedMotion,
      isolate,
      explode,
    };
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

  // The CT skeleton loads beside the atlas, the first time anyone moves past
  // the scan with one configured and on; switched off, it is disposed.
  useEffect(() => {
    if (!requested || !skeleton) return;
    let cancelled = false;
    let loaded: PreparedSkeleton | null = null;
    const report = onSkeletonLoad ?? (() => undefined);
    report({ kind: "loading" });
    loadAtlasGltf(SKELETON_API_URL, () => undefined)
      .then((gltf) => {
        if (cancelled) {
          disposeObject3D(gltf.scene);
          return;
        }
        let ready: PreparedSkeleton;
        try {
          ready = prepareSkeleton(gltf.scene, skeleton);
        } catch {
          disposeObject3D(gltf.scene);
          report({ kind: "error" });
          return;
        }
        loaded = ready;
        bonesRef.current = ready;
        setBones(ready);
      })
      .catch(() => {
        if (!cancelled) report({ kind: "error" });
      });
    return () => {
      cancelled = true;
      bonesRef.current = null;
      setBones(null);
      report({ kind: "idle" });
      if (loaded) {
        loaded.root.removeFromParent();
        disposeObject3D(loaded.root);
      }
    };
  }, [requested, skeleton, retry, onSkeletonLoad]);

  useEffect(() => {
    if (!scanRoot || !requested) return;
    const surfaces = collectScanMaterials(scanRoot).flatMap((material) => {
      const uniforms = attachLayerFade(material, createLayerUniforms(0.06));
      return uniforms ? [{ material, uniforms }] : [];
    });
    scanSurfacesRef.current = surfaces;
    setScanRenderOrder(scanRoot, SCAN_RENDER_ORDER);
    invalidate();
    return () => {
      scanSurfacesRef.current = [];
      setScanRenderOrder(scanRoot, 0);
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

  const bonesFit = useMemo(
    () =>
      bones && scanRoot
        ? fitSkeletonToScan(
            { box: bones.box, hipBox: bones.hipBox },
            readScanFrame(scanRoot, statureM),
          )
        : null,
    [bones, scanRoot, statureM],
  );

  const bonesTransform = useMemo(() => {
    if (!bonesFit?.ok) return null;
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    bonesFit.matrix.decompose(position, quaternion, scale);
    return { position, quaternion, scale };
  }, [bonesFit]);

  useEffect(() => {
    bonesFitOkRef.current = bonesFit?.ok === true;
    if (!bones || !bonesFit) return;
    onSkeletonLoad?.({
      kind: "ready",
      anchor: bonesFit.anchor,
      fitOk: bonesFit.ok,
      bones: bones.parts.length,
      modelled: bones.parts.filter((part) => part.modelled).length,
    });
    invalidate();
  }, [bones, bonesFit, onSkeletonLoad, invalidate]);

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
    const all = [...(prepared?.parts ?? []), ...(bones?.parts ?? [])];
    if (all.length === 0) return;
    const lit = new Set(highlight ? partsFor(highlight, all) : []);
    const colour = new Color(ring);
    for (const part of all) {
      setHighlighted(part.mesh.material as Material, lit.has(part) ? colour : null);
    }
    invalidate();
    return () => {
      for (const part of all) {
        setHighlighted(part.mesh.material as Material, null);
      }
    };
  }, [prepared, bones, highlight, ring, invalidate]);

  // Frames render on demand: kick one whenever an input changes.
  useEffect(() => {
    invalidate();
  }, [targetDepth, layers, hiddenSystems, isolate, explode, invalidate]);

  useFrame((_, delta) => {
    const {
      targetDepth: wanted,
      layers: shown,
      hiddenSystems: hidden,
      reducedMotion: reduced,
      isolate: alone,
      explode: spread,
    } = live.current;
    const atlas = preparedRef.current;
    const ct = bonesRef.current;
    const ctReady = ct !== null && bonesFitOkRef.current;
    const ready = (atlas !== null && fitOkRef.current) || ctReady;
    const next = dampDepth(depthRef.current, ready ? wanted : 0, delta, reduced);
    const nextSpread = dampDepth(
      explodeRef.current,
      ctReady ? spread : 0,
      delta,
      reduced,
    );
    const moving = next !== depthRef.current || nextSpread !== explodeRef.current;
    depthRef.current = next;
    explodeRef.current = nextSpread;

    const scanMix = viewMix("scan", next, alone);
    for (const surface of scanSurfacesRef.current) {
      applyMixToUniforms(surface.uniforms, scanMix);
      setBlendMode(surface.material, blendModeFor(scanMix, "scan"));
    }

    if (atlas) {
      // With the CT skeleton in place the atlas draws no bones of its own.
      const atlasShown = ctReady ? { ...shown, skeleton: false } : shown;
      for (const layer of ATLAS_LAYER_IDS) {
        applyMixToUniforms(atlas.uniforms[layer], viewMix(layer, next, alone));
      }
      for (const part of atlas.parts) {
        const mix = applyMask(
          viewMix(part.layer, next, alone),
          partShown(part, atlasShown, hidden),
        );
        const mode = blendModeFor(mix, "atlas");
        Object.assign(part.mesh, { visible: mix.visible });
        setBlendMode(part.mesh.material as Material, mode);
        setLayerPasses(part.mesh, part.layer, mode);
      }
    }
    if (ct) {
      const mix = applyMask(viewMix("skeleton", next, alone), shown.skeleton && ctReady);
      const mode = blendModeFor(mix, "atlas");
      applyMixToUniforms(ct.uniforms, mix);
      for (const part of ct.parts) {
        Object.assign(part.mesh, { visible: mix.visible });
        setBlendMode(part.mesh.material as Material, mode);
        setLayerPasses(part.mesh, "skeleton", mode);
      }
      applyExplode(ct.parts, nextSpread);
    }
    if (moving) invalidate();
  });

  // Picks the body outline before any atlas is loaded, and atlas parts once one is.
  const readDepth = useCallback(() => depthRef.current, []);
  const ready = prepared !== null && transform !== null;
  const bonesReady = bones !== null && bonesTransform !== null;
  const pickParts = useMemo(
    () => [
      ...(ready
        ? prepared.parts.filter((part) => !(bonesReady && part.layer === "skeleton"))
        : NO_PARTS),
      ...(bonesReady ? bones.parts : NO_PARTS),
    ],
    [ready, prepared, bonesReady, bones],
  );
  const pick = (
    <PickSurface
      enabled={onPick !== undefined}
      scanRoot={scanRoot}
      parts={pickParts}
      groups={ready ? prepared.groups : NO_GROUPS}
      getDepth={readDepth}
      layers={layers}
      hiddenSystems={hiddenSystems}
      isolate={isolate}
      onPick={onPick ?? ignorePick}
    />
  );
  const ctGroup = bonesReady ? (
    <group
      position={bonesTransform.position}
      quaternion={bonesTransform.quaternion}
      scale={bonesTransform.scale}
    >
      <primitive object={bones.root} />
    </group>
  ) : null;
  if (!ready) {
    return (
      <>
        {pick}
        {ctGroup}
      </>
    );
  }
  return (
    <>
      {pick}
      {ctGroup}
      {liveVitals ? (
        <LiveConditioning
          enabled={liveVitals.enabled}
          vitals={liveVitals.vitals}
          scheme={ATLASES[atlasId].scheme}
          parts={prepared.parts}
          root={prepared.root}
          chambers={liveVitals.chambers}
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

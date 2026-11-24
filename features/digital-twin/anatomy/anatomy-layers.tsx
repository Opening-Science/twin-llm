"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Box3,
  Color,
  type Material,
  type Object3D,
  Quaternion,
  Vector3,
} from "three";

import { type DemoBodyId } from "@/packages/anatomy/demo-bodies";
import {
  fitAtlasToScan,
  fitSkeletonToAtlas,
  fitSkeletonToScan,
  placeFittedAtlas,
} from "@/packages/anatomy/fit";
import { fittedAtlasApiUrl } from "@/packages/anatomy/fitted-atlases";
import { partsFor, type Highlight } from "@/packages/anatomy/highlight";
import {
  applyMask,
  ATLAS_LAYER_IDS,
  dampDepth,
  partShown,
  drawnIsolate,
  viewMix,
  type AtlasLayerId,
} from "@/packages/anatomy/layers";
import { ATLASES, atlasApiUrl, type AtlasId } from "@/packages/anatomy/manifest";
import { ctRegions } from "@/packages/anatomy/ct-cover";
import { type SkeletonAtlas } from "@/packages/anatomy/open-skeleton";
import { type OrganSystem } from "@/packages/anatomy/systems";

import { disposeObject3D } from "../dispose-object";
import { type Picked } from "../environment/pick-part";
import { PickSurface } from "../environment/pick-surface";
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
import { applyCtTrim, type CtTrim, trimAtlasForCt } from "./trim-atlas";
import { SCAN_RENDER_ORDER, setLayerPasses, setScanRenderOrder } from "./depth-prepass";
import { focusesHeartHighlight, heartGroupWorldBox } from "./heart-geometry";
import { collectScanMaterials, readScanFrame, readSkeletonScanFrame } from "./scan-frame";
import { attachGlucoseHeartOpacity, setGlucoseHeartOpacity } from "./glucose-material";
import { organFocusOpacity } from "./organ-focus";
import {
  AtlasVisualizationEffect,
  resolveAtlasVisualization,
  type AtlasVisualization,
} from "./atlas-visualization";

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
 * Skeleton layer where it has bones: the atlas hides the bones the CT build
 * has and keeps the rest (skull, neck, shoulders, limbs), and the CT bones
 * fade, isolate and spread apart on the same uniforms and passes as the atlas
 * layers.
 */
export const AnatomyLayers = ({
  scanRoot,
  statureM,
  atlasId,
  fittedBody = null,
  requested,
  retry,
  targetDepth,
  layers,
  hiddenSystems,
  highlight,
  highlightFromPick = false,
  reducedMotion,
  onLoad,
  onPick,
  onHeartFocus,
  isolate = null,
  explode = 0,
  skeleton = null,
  onSkeletonLoad,
  visualization = null,
  moving = false,
}: Readonly<{
  scanRoot: Object3D | null;
  /** The scan's measured stature in metres, when it has one; the fit prefers it. */
  statureM: number | null;
  atlasId: AtlasId;
  /**
   * The demo body the atlas was refitted to in Blender, when "Fit atlas to
   * body" shows it: that file loads and takes the body's own transform.
   */
  fittedBody?: DemoBodyId | null;
  requested: boolean;
  retry: number;
  targetDepth: number;
  layers: Readonly<Record<AtlasLayerId, boolean>>;
  hiddenSystems: readonly OrganSystem[];
  highlight: Highlight | null;
  highlightFromPick?: boolean;
  reducedMotion: boolean;
  onLoad: (load: AnatomyLoad) => void;
  /** A tap on the body or a part, inline and in the environment; absent, nothing picks. */
  onPick?: (picked: Picked | null) => void;
  onHeartFocus?: (box: Box3) => void;
  /** The layer shown alone and solid, if any. */
  isolate?: AtlasLayerId | null;
  /** How far the CT bones are spread apart, 0..1. */
  explode?: number;
  /** The configured CT skeleton's atlas.json, when it is on; null draws the atlas's bones. */
  skeleton?: SkeletonAtlas | null;
  onSkeletonLoad?: (load: SkeletonLoad) => void;
  visualization?: AtlasVisualization | null;
  moving?: boolean;
}>) => {
  const invalidate = useThree((state) => state.invalidate);
  const ring = useTwinPalette().ring;
  const url =
    fittedBody === null ? atlasApiUrl(atlasId) : fittedAtlasApiUrl(fittedBody, atlasId);
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
  const activeVisualization = resolveAtlasVisualization(visualization, {
    atlasId,
    fitted: fittedBody !== null,
    moving,
  });
  const organFocusOn = activeVisualization?.focus === "heart";
  const vesselsVisible = useCallback(
    () =>
      preparedRef.current?.parts.some(
        (part) => part.system === "cardiovascular" && part.mesh.visible,
      ) === true,
    [],
  );
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
    loadAtlasGltf(url, (fraction) => {
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
          if (atlasId === "bodyparts3d" && fittedBody === null) {
            for (const part of ready.parts) {
              if (part.system === "cardiovascular") attachGlucoseHeartOpacity(part.mesh);
            }
          }
        } catch (error) {
          console.error("[anatomy] Atlas preparation failed", error);
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
  }, [requested, atlasId, fittedBody, url, retry, onLoad]);

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
    if (fittedBody !== null) {
      // Blender fitted it in the body's own frame at its bind pose.
      const frame = readScanFrame(scanRoot, null);
      return placeFittedAtlas(prepared.box, { matrixWorld: scanRoot.matrixWorld, frame });
    }
    return fitAtlasToScan(
      { box: prepared.box, hipAnchor: entry.hipAnchor, mirrorX: entry.mirrorX },
      readScanFrame(scanRoot, statureM),
    );
  }, [prepared, scanRoot, statureM, atlasId, fittedBody]);

  const transform = useMemo(() => {
    if (!fit?.ok) return null;
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    fit.matrix.decompose(position, quaternion, scale);
    return { position, quaternion, scale };
  }, [fit]);

  // Beside the CT skeleton the atlas keeps the bones the CT build lacks.
  const atlasTrim = useMemo(
    () =>
      prepared && bones
        ? trimAtlasForCt(
            prepared.root,
            prepared.parts,
            ATLASES[atlasId].scheme,
            ctRegions(bones.parts.map((part) => part.label)),
          )
        : null,
    [prepared, bones, atlasId],
  );
  const trims = atlasTrim?.trims ?? null;
  const trimsRef = useRef(trims);
  useEffect(() => {
    trimsRef.current = trims;
    invalidate();
  }, [trims, invalidate]);

  // The CT trunk joins the atlas's neck, shoulders and legs when the atlas has
  // its trunk marks; otherwise it stands at its own size at the body's hips.
  const bonesFit = useMemo(() => {
    if (!bones || !scanRoot) return null;
    const frame = { box: bones.box, hipBox: bones.hipBox, spine: bones.spine };
    const marks = atlasTrim?.marks;
    const onAtlas =
      marks && fit?.ok
        ? fitSkeletonToAtlas(frame, {
            hips: marks.hips.clone().applyMatrix4(fit.matrix),
            t1: marks.t1.clone().applyMatrix4(fit.matrix),
          })
        : null;
    return onAtlas ?? fitSkeletonToScan(frame, readSkeletonScanFrame(scanRoot, statureM));
  }, [bones, scanRoot, statureM, atlasTrim, fit]);

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
      box: bonesFit.ok
        ? (() => {
            const placed = bones.box.clone().applyMatrix4(bonesFit.matrix);
            return { min: placed.min.toArray(), max: placed.max.toArray() };
          })()
        : null,
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
  }, [targetDepth, layers, hiddenSystems, isolate, explode, organFocusOn, invalidate]);

  useFrame((_, delta) => {
    const {
      targetDepth: wanted,
      layers: shown,
      hiddenSystems: hidden,
      reducedMotion: reduced,
      isolate: chosen,
      explode: spread,
    } = live.current;
    const atlas = preparedRef.current;
    const ct = bonesRef.current;
    const ctReady = ct !== null && bonesFitOkRef.current;
    const atlasReady = atlas !== null && fitOkRef.current;
    const ready = atlasReady || ctReady;
    // The scan hides for an isolated layer only once that layer is showing.
    const alone = drawnIsolate(
      chosen,
      (layer) => shown[layer] && (atlasReady || (layer === "skeleton" && ctReady)),
    );
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
      // With the CT skeleton in place the atlas draws only the bones it lacks.
      const trims = trimsRef.current;
      for (const layer of ATLAS_LAYER_IDS) {
        applyMixToUniforms(atlas.uniforms[layer], viewMix(layer, next, alone));
      }
      for (const part of atlas.parts) {
        const trim: CtTrim =
          ctReady && part.layer === "skeleton"
            ? (trims?.get(part.mesh) ?? "none")
            : "all";
        if (part.layer === "skeleton") applyCtTrim(part.mesh, trim, ctReady);
        const mix = applyMask(
          viewMix(part.layer, next, alone),
          partShown(part, shown, hidden) && trim !== "none",
        );
        const focusOrgan = organFocusOn && part.layer === "organs";
        // A shared depth prepass would hide the heart behind other translucent organs.
        const mode = focusOrgan ? "blend" : blendModeFor(mix, "atlas");
        Object.assign(part.mesh, { visible: mix.visible });
        Object.assign(part.mesh.material, {
          opacity: organFocusOpacity(
            part,
            focusOrgan,
            atlasId === "bodyparts3d" && fittedBody !== null,
          ),
        });
        setGlucoseHeartOpacity(part.mesh.material as Material, focusOrgan);
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
        ? prepared.parts.filter(
            (part) =>
              !bonesReady ||
              part.layer !== "skeleton" ||
              (trims?.get(part.mesh) ?? "none") !== "none",
          )
        : NO_PARTS),
      ...(bonesReady ? bones.parts : NO_PARTS),
    ],
    [ready, prepared, bonesReady, bones, trims],
  );
  // The layer drawn alone, once it is showing; picks and the heart focus follow it.
  const shownIsolate = drawnIsolate(
    isolate,
    (layer) => layers[layer] && (ready || (layer === "skeleton" && bonesReady)),
  );
  useEffect(() => {
    if (!ready || !onHeartFocus || !focusesHeartHighlight(highlight, highlightFromPick))
      return;
    const box = heartGroupWorldBox(
      prepared.parts,
      targetDepth,
      layers,
      hiddenSystems,
      shownIsolate,
    );
    if (box) onHeartFocus(box);
  }, [
    ready,
    prepared,
    highlight,
    highlightFromPick,
    onHeartFocus,
    layers,
    hiddenSystems,
    targetDepth,
    shownIsolate,
  ]);
  const pick = (
    <PickSurface
      enabled={onPick !== undefined}
      scanRoot={scanRoot}
      parts={pickParts}
      groups={ready ? prepared.groups : NO_GROUPS}
      getDepth={readDepth}
      layers={layers}
      hiddenSystems={hiddenSystems}
      isolate={shownIsolate}
      onPick={onPick ?? ignorePick}
      onHeartFocus={onHeartFocus}
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
      <group
        position={transform.position}
        quaternion={transform.quaternion}
        scale={transform.scale}
      >
        <primitive object={prepared.root} />
        {activeVisualization ? (
          <AtlasVisualizationEffect
            visualization={activeVisualization.effect}
            atlasId={atlasId}
            atlas={prepared}
            reducedMotion={reducedMotion}
            vesselsVisible={vesselsVisible}
          />
        ) : null}
      </group>
    </>
  );
};

"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useTheme } from "next-themes";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ACESFilmicToneMapping,
  Box3,
  type Group,
  type Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  type Texture,
  Vector3,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import type { VitronicPropertyRow } from "@/features/vitronic/vitronic-status-view";
import {
  LABEL_HINT,
  VITRONIC_SUBJECT_SOURCE_SCANNER,
} from "@/features/vitronic/subject-schema";
import {
  ANNY_CODE_LICENCE_URL,
  ANNY_PAPER_URL,
  ANNY_SHAPE_LICENCE_URL,
  DEMO_BODIES,
  demoBodyApiUrl,
  demoBodyIdFor,
} from "@/packages/anatomy/demo-bodies";
import { ATLASES } from "@/packages/anatomy/manifest";
import { RIGGED_ATTRIBUTION, riggedBodyApiUrl } from "@/packages/anatomy/rigged-bodies";
import { Button } from "@/infrastructure/ui-kit/button";
import { Field } from "@/infrastructure/ui-kit/field";
import { Legend } from "@/infrastructure/ui-kit/legend";
import { AnatomyControls } from "./anatomy/anatomy-controls";
import { AnatomyLayers } from "./anatomy/anatomy-layers";
import { highlightValue } from "./anatomy/highlight-options";
import { BodyPanel, type PanelTab } from "./body-panel";
import { useBiomarkerTab } from "./biomarkers/use-biomarker-tab";
import {
  DEMO_BODY_NOTE,
  DEMO_BODY_PICKER,
  DEMO_LOAD_ERROR,
  DEMO_SEX_LABEL,
  type DemoSex,
} from "./anatomy/demo-copy";
import { loadAtlasGltf } from "./anatomy/load-atlas";
import { useAnatomyView } from "./anatomy/use-anatomy-view";
import { prepareDemoBody } from "./demo-body";
import { BodyMotion } from "./motion/body-motion";
import { motionLines } from "./motion/motion-copy";
import { useBodyMotion } from "./motion/use-body-motion";
import {
  EnvironmentBar,
  EnvironmentPanel,
  ResearchLine,
} from "./environment/environment-bar";
import { createAnchorStore } from "./environment/card-anchor";
import {
  ENVIRONMENT_LABEL,
  PANEL_TEXT,
  pickedLabel,
  VIEW_LABEL,
} from "./environment/environment-copy";
import { PickCard, ProjectAnchor } from "./environment/pick-card";
import { IDLE_STATUS, type LiveStatus } from "./live/live-conditioning";
import { LiveLines } from "./live/live-lines";
import { NIGHT_NEEDS_READINGS } from "./live/live-copy";
import { NightPlayback, useNightPlayback } from "./live/night-playback";
import { nightPlaybackFor } from "./live/night-series";
import {
  linkedRows,
  pickHighlight,
  pickHighlights,
  pickVisible,
  type Picked,
} from "./environment/pick-part";
import { INLINE_LIGHT, lookFor, type WorldLook } from "./environment/environment-look";
import { EnvironmentWorld } from "./environment/environment-world";
import { useEnvironment, useLocalHour } from "./environment/use-environment";
import { clampToRadius, WALK_RADIUS_M } from "./environment/walk";
import { WALK_SURFACE_ATTR, WalkControls } from "./environment/walk-controls";
import {
  DEMO_SUBJECT_ID,
  defaultSubjectId,
  isDemoSubject,
  subjectOptions,
} from "./demo-subject";
import { disposeObject3D } from "./dispose-object";
import { FloorPool } from "./floor-pool";
import { nextAutoRotateDelay } from "./frame-pacing";
import { mergeScanRows, orderScans, pickDefaultScan } from "./scan-default";
import {
  downscaleImage,
  initialAutoRotate,
  prepareScanMaterials,
  prepareScanTextures,
  releaseImage,
} from "./scan-materials";
import {
  collectLabels,
  DEFAULT_OVERLAYS,
  OVERLAY_OPTIONS,
  overlayLegendItems,
  OverlayPrimitives,
  parseSnapshotGeometry,
  ProjectedLabels,
  shouldProjectLabels,
  visibleMarkers,
  visibleMeasures,
  type OverlayToggles,
} from "./scan-overlays";
import { type TwinContext } from "./page-sections";
import { initialPanel, panelReducer } from "./panel-state";
import { ViewToolbar } from "./view-toolbar";
import { useWheelGate, WHEEL_ZOOM_HINT } from "./wheel-zoom";

export const BODYLOOP_EMPTY = "No BodyLoop scan on this account.";
export const BODY_TWIN_LOADING = "Loading body twin…";
export const BODYLOOP_NO_SCANS = "No scans for this subject.";
export const BODYLOOP_NO_MESH = "No 3D model stored for this scan — Sync again";
export const SCAN_SYNC = "Sync this scan";
export const SCAN_SYNC_AGAIN = "Sync again";
export const SCAN_RESYNC = "Re-sync";
export const SCAN_SET_DEFAULT = "Set as default";
export const SCAN_CLEAR_DEFAULT = "Clear default";
export const SCAN_DEFAULT_TAG = "default";
export const SCAN_DEFAULT_FAILED = "Could not save the default scan.";
export const BODY_VIEW_LOST =
  "The 3D view stopped: the browser lost its graphics context.";
export const BODY_VIEW_RELOAD = "Reload 3D view";
export const DEMO_NEEDS_WEBGL = "Demo body needs WebGL.";
export const SCAN_NEEDS_WEBGL = "Scan mesh needs WebGL.";

const DEMO_SEXES: readonly DemoSex[] = ["male", "female"];
const NO_MARKERS: ReturnType<typeof visibleMarkers> = [];
const NO_MEASURES: ReturnType<typeof visibleMeasures> = [];
const DEMO_PANEL_TABS: readonly PanelTab[] = ["biomarkers"];

/** Measured stature in metres from a snapshot's `body.height`, or null. */
export const snapshotStature = (
  properties: readonly VitronicPropertyRow[],
): number | null => {
  const row = properties.find((item) => item.path === "body.height" && item.unit === "m");
  return row && Number.isFinite(row.value) && row.value > 0 ? row.value : null;
};

/** The demo load error belongs to one URL; a later success or another body clears it. */
export const demoErrorShown = (failedUrl: string | null, url: string): boolean =>
  failedUrl === url;

/** Highlights set by a pick; a body or empty pick clears only these. */
const PICK_PREFIX = "pick:";

/** A long pause (tab hidden, canvas off screen) must not turn into one big jump. */
const MAX_ROTATE_DELTA_S = 0.1;

export type BodyTwinSubject = Readonly<{
  id: string;
  label: string;
  isSelf: boolean;
  source?: string;
  defaultViatarId?: number | null;
}>;

export type BodyTwinScan = Readonly<{
  viatarId: number;
  crtime: string | null;
  synced?: boolean;
  incomplete?: boolean;
  presetName?: string | null;
}>;

export type BodyTwinSnapshot = Readonly<{
  id: string;
  viatarId: number;
  hasAvatar: boolean;
  presetName?: string | null;
  properties: readonly VitronicPropertyRow[];
  markers?: unknown;
  measures?: unknown;
}>;

export type BodyTwinPreview = Readonly<{
  subjects?: readonly BodyTwinSubject[];
  scans?: readonly BodyTwinScan[];
  snapshots?: readonly BodyTwinSnapshot[];
  selectedSubjectId?: string;
  selectedViatarId?: number;
}>;

type BodyLoopAvatarProps = {
  readonly preview?: BodyTwinPreview;
  readonly forceFallback?: boolean;
  /** Tells the page which subject is shown and what it has, for its Sources section. */
  readonly onContext?: (context: TwinContext) => void;
};

/** BodyLoop helper geometry that must not show inside the (glass) scan. */
export const HIDDEN_NODE_NAMES: ReadonlySet<string> = new Set([
  "AutoMarkers",
  "PalpationMarkers",
  "Analysis_Spine",
]);

const hiddenOverlayNodes = (root: Object3D): readonly Object3D[] => {
  const found: Object3D[] = [];
  root.traverse((obj) => {
    if (HIDDEN_NODE_NAMES.has(obj.name)) found.push(obj);
  });
  return found;
};

export const hideOverlayNodes = (root: Object3D): void => {
  for (const node of hiddenOverlayNodes(root)) {
    node.visible = false;
  }
};

/** Z-up BodyLoop fit. Near/far come from a new PerspectiveCamera copied onto `camera`. */
export const fitCameraToBox = (camera: PerspectiveCamera, box: Box3): Vector3 => {
  const center = box.getCenter(new Vector3());
  if (box.isEmpty()) return center;
  const size = box.getSize(new Vector3());
  const span = Math.max(size.x, size.y, size.z, 0.5);
  const fitted = new PerspectiveCamera(camera.fov, camera.aspect, span / 80, span * 20);
  fitted.up.set(0, 0, 1);
  fitted.position.set(center.x, center.y - span * 1.8, center.z + size.z * 0.05);
  fitted.lookAt(center);
  fitted.updateProjectionMatrix();
  camera.copy(fitted);
  camera.up.set(0, 0, 1);
  camera.position.set(center.x, center.y - span * 1.8, center.z + size.z * 0.05);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  return center;
};

const FitZUpCamera = ({
  object,
  camera,
  resetKey,
  onTarget,
}: {
  readonly object: Object3D;
  readonly camera: PerspectiveCamera;
  readonly resetKey: number;
  readonly onTarget: (center: Vector3) => void;
}) => {
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    const center = fitCameraToBox(camera, new Box3().setFromObject(object));
    onTarget(center);
    invalidate();
  }, [object, camera, invalidate, resetKey, onTarget]);
  return null;
};

export const AUTO_ROTATE_SPEED = 1.25;
export const AUTO_ROTATE_IDLE_MS = 5000;
/** Close enough for an organ, far enough to keep the whole body in view. */
export const MIN_ZOOM_DISTANCE = 0.25;
export const MAX_ZOOM_DISTANCE = 6;
/** One button press: dollyIn(0.8) moves 20% closer, dollyOut(0.8) 25% further. */
export const ZOOM_STEP = 0.8;

const ScanOrbitControls = ({
  camera,
  target,
  autoRotate,
  onUserRotate,
  onControls,
  walk,
}: {
  readonly camera: PerspectiveCamera;
  readonly target: Vector3;
  readonly autoRotate: boolean;
  readonly onUserRotate: () => void;
  readonly onControls: (controls: OrbitControls | null) => void;
  /** In the environment a pan slides along the ground and stays near the body. */
  readonly walk: boolean;
}) => {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const controlsRef = useRef<OrbitControls | null>(null);
  const visibleRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  // `update()` in the frame loop emits "change" too; only user input should redraw at once.
  const inFrameUpdateRef = useRef(false);
  // Controls are rebuilt when the target changes (Reset view); keep the current turn.
  const autoRotateRef = useRef(autoRotate);
  const walkRef = useRef(walk);
  useEffect(() => {
    autoRotateRef.current = autoRotate;
    walkRef.current = walk;
  });

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = true;
    controls.autoRotate = autoRotateRef.current;
    controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
    controls.minDistance = MIN_ZOOM_DISTANCE;
    controls.maxDistance = MAX_ZOOM_DISTANCE;
    controls.zoomToCursor = true;
    // Controls are rebuilt on Reset and on a rotate toggle; keep ground panning across that.
    controls.screenSpacePanning = !walkRef.current;
    controls.target.copy(target);
    camera.up.set(0, 0, 1);
    const onChange = () => {
      if (walkRef.current) {
        // A two-finger or right-drag pan walks too; it stops at the walk radius.
        const kept = clampToRadius(
          [controls.target.x, controls.target.y],
          [target.x, target.y],
          WALK_RADIUS_M,
        );
        const dx = kept[0] - controls.target.x;
        const dy = kept[1] - controls.target.y;
        if (dx !== 0 || dy !== 0) {
          // Target and camera are three.js vectors the controls read each update.
          controls.target.set(kept[0], kept[1], controls.target.z);
          camera.position.set(
            camera.position.x + dx,
            camera.position.y + dy,
            camera.position.z,
          );
        }
      }
      if (!inFrameUpdateRef.current) invalidate();
    };
    const onStart = () => onUserRotate();
    controls.addEventListener("change", onChange);
    controls.addEventListener("start", onStart);
    controlsRef.current = controls;
    onControls(controls);
    invalidate();
    return () => {
      controls.removeEventListener("change", onChange);
      controls.removeEventListener("start", onStart);
      controls.dispose();
      controlsRef.current = null;
      onControls(null);
    };
  }, [camera, gl, invalidate, target, onUserRotate, onControls]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (controls) controls.autoRotate = autoRotate;
    invalidate();
  }, [autoRotate, invalidate]);

  // Inline a pan moves in the screen plane, as before; walking pans along the ground.
  useEffect(() => {
    const controls = controlsRef.current;
    if (controls) controls.screenSpacePanning = !walk;
  }, [walk, target]);

  // Off screen, auto-rotate stops asking for frames; back on screen, one frame restarts it.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      const wasVisible = visibleRef.current;
      visibleRef.current = visible;
      if (visible && !wasVisible) invalidate();
    });
    observer.observe(gl.domElement);
    return () => observer.disconnect();
  }, [gl, invalidate]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    [],
  );

  // Frames render on demand. Damping asks for the next frame at once; auto-rotate
  // alone asks at ~30 fps. The delta keeps the turn speed independent of the rate.
  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    inFrameUpdateRef.current = true;
    const moved = controls.update(Math.min(delta, MAX_ROTATE_DELTA_S));
    inFrameUpdateRef.current = false;
    if (!controls.autoRotate) {
      if (moved) invalidate();
      return;
    }
    if (timerRef.current !== null) return;
    const now = performance.now();
    const wait = nextAutoRotateDelay({
      lastDrawMs: now,
      nowMs: now,
      visible: visibleRef.current,
    });
    if (wait === null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      invalidate();
    }, wait);
  });
  return null;
};

/**
 * RoomEnvironment is built Y-up with its brightest emitter at +Y; the scan is
 * Z-up and faces -Y. Rotating the environment +90° about X puts that emitter
 * overhead, so the front is not lit from the floor.
 */
const ScanEnvironment = ({ intensity }: Readonly<{ intensity: number }>) => {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const [texture, setTexture] = useState<Texture | null>(null);
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    pmrem.dispose();
    // three.js reads the scene's environment rotation each draw; it is set in place.
    Object.assign(scene.environmentRotation, { x: Math.PI / 2, y: 0, z: 0 });
    setTexture(env.texture);
    return () => {
      env.texture.dispose();
      Object.assign(scene.environmentRotation, { x: 0, y: 0, z: 0 });
      setTexture(null);
    };
  }, [gl, scene]);
  useEffect(() => {
    // A uniform the renderer reads each draw; the environment dims it at night.
    Object.assign(scene, { environmentIntensity: intensity });
    invalidate();
    return () => {
      Object.assign(scene, { environmentIntensity: 1 });
    };
  }, [scene, intensity, invalidate]);
  if (!texture) return null;
  return <primitive attach="environment" object={texture} />;
};

const BodyScan = ({
  url,
  kind,
  onError,
  onReady,
  dark,
  camera,
  showLandmarks,
  resetKey,
  autoRotate,
  onUserRotate,
  markers,
  measures,
  highlightId,
  onHover,
  onLabels,
  onScene,
  onControls,
  world,
  walk,
  getControls,
}: {
  readonly url: string;
  /** "demo" is a meshopt-compressed ANNY body in the atlas frame; "scan" a BodyLoop GLB. */
  readonly kind: "scan" | "demo";
  readonly onError?: (url: string) => void;
  readonly onReady?: (url: string) => void;
  readonly dark: boolean;
  readonly camera: PerspectiveCamera;
  readonly showLandmarks: boolean;
  readonly resetKey: number;
  readonly autoRotate: boolean;
  readonly onUserRotate: () => void;
  readonly onScene: (scene: Group | null) => void;
  readonly onControls: (controls: OrbitControls | null) => void;
  /** The full-screen environment's sky and ground, or null inline. */
  readonly world: WorldLook | null;
  /** The environment's walking: keys, ground pans and the walk radius. */
  readonly walk: boolean;
  readonly getControls: () => OrbitControls | null;
  readonly markers: ReturnType<typeof visibleMarkers>;
  readonly measures: ReturnType<typeof visibleMeasures>;
  readonly highlightId: string | null;
  readonly onHover: (id: string | null) => void;
  readonly onLabels: (
    rows: readonly { id: string; text: string; x: number; y: number }[],
  ) => void;
}) => {
  const gl = useThree((state) => state.gl);
  const [scene, setScene] = useState<Group | null>(null);
  const [target, setTarget] = useState<Vector3 | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: Group | null = null;
    if (kind === "demo") {
      void loadAtlasGltf(url, () => undefined)
        .then((gltf) => {
          if (cancelled) {
            disposeObject3D(gltf.scene);
            return;
          }
          const body = prepareDemoBody(gltf.scene);
          loaded = body;
          setScene(body);
          onScene(body);
          onReady?.(url);
        })
        .catch(() => {
          if (cancelled) return;
          setScene(null);
          onScene(null);
          onError?.(url);
        });
    } else {
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => {
          if (cancelled) {
            disposeObject3D(gltf.scene);
            return;
          }
          prepareScanMaterials(gltf.scene, {
            log: process.env.NODE_ENV === "development",
          });
          // Before the scan joins the scene, so the 8K originals never reach the GPU.
          prepareScanTextures(gltf.scene, {
            maxAnisotropy: gl.capabilities.getMaxAnisotropy(),
            deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number })
              .deviceMemory,
            resize: downscaleImage,
            release: releaseImage,
          });
          hideOverlayNodes(gltf.scene);
          loaded = gltf.scene;
          setScene(gltf.scene);
          onScene(gltf.scene);
        },
        undefined,
        () => {
          if (!cancelled) {
            setScene(null);
            onScene(null);
          }
        },
      );
    }
    return () => {
      cancelled = true;
      setScene(null);
      onScene(null);
      // Free the scan's GPU memory on a switch; dropping it from state does not.
      if (loaded) {
        loaded.removeFromParent();
        disposeObject3D(loaded);
      }
    };
  }, [url, kind, gl, onScene, onError, onReady]);

  const overlayLabels = useMemo(
    () => collectLabels(markers, measures, highlightId),
    [markers, measures, highlightId],
  );

  if (!scene) return null;
  return (
    <>
      <FitZUpCamera
        object={scene}
        camera={camera}
        resetKey={resetKey}
        onTarget={setTarget}
      />
      {target ? (
        <ScanOrbitControls
          camera={camera}
          target={target}
          autoRotate={autoRotate}
          onUserRotate={onUserRotate}
          onControls={onControls}
          walk={walk}
        />
      ) : null}
      <WalkControls
        enabled={walk}
        camera={camera}
        center={target}
        getControls={getControls}
        onWalk={onUserRotate}
      />
      <primitive object={scene} />
      <FloorPool object={scene} dark={dark} />
      {world ? <EnvironmentWorld object={scene} world={world} /> : null}
      {showLandmarks ? (
        <OverlayPrimitives
          markers={markers}
          measures={measures}
          highlightId={highlightId}
          onHover={onHover}
        />
      ) : null}
      {shouldProjectLabels(showLandmarks, overlayLabels) ? (
        <ProjectedLabels labels={overlayLabels} camera={camera} onScreen={onLabels} />
      ) : null}
    </>
  );
};

/**
 * Probes WebGL once per page and releases the probe context. Probing on every
 * render created a new context each time; browsers cap live contexts and drop
 * the oldest, which can be the viewer's own.
 */
let webglProbe: boolean | null = null;

const probeWebgl = (): boolean => {
  if (webglProbe !== null) return webglProbe;
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    webglProbe = context !== null;
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglProbe = false;
  }
  return webglProbe;
};

const subscribeNever = () => () => undefined;

/** False on the server and during hydration, the cached probe afterwards. */
const useWebglAvailable = (): boolean =>
  useSyncExternalStore(subscribeNever, probeWebgl, () => false);

/**
 * Reports a lost WebGL context while this canvas is mounted. The listener is
 * removed on unmount, before R3F force-loses the old context on purpose, so a
 * normal unmount never looks like a failure. Mounting means a fresh context.
 */
const ContextLossWatcher = ({
  onLost,
  onFresh,
}: {
  readonly onLost: () => void;
  readonly onFresh: () => void;
}) => {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    const handler = (event: Event) => {
      event.preventDefault();
      onLost();
    };
    onFresh();
    canvas.addEventListener("webglcontextlost", handler);
    return () => canvas.removeEventListener("webglcontextlost", handler);
  }, [gl, onLost, onFresh]);
  return null;
};

const scanLabel = (scan: BodyTwinScan, pinnedViatarId: number | null): string => {
  const day = scan.crtime ? scan.crtime.slice(0, 10) : "unknown date";
  const status = scan.incomplete
    ? SCAN_SYNC_AGAIN
    : scan.synced === true
      ? "synced"
      : "not synced";
  const preset = scan.presetName ? ` · ${scan.presetName}` : "";
  const pinned = scan.viatarId === pinnedViatarId ? ` · ${SCAN_DEFAULT_TAG}` : "";
  return `${day} · scan ${scan.viatarId} · ${status}${preset}${pinned}`;
};

type SubjectsPayload = { readonly subjects?: readonly BodyTwinSubject[] };
type ScansPayload = { readonly scans?: readonly BodyTwinScan[] };
type SnapshotsPayload = { readonly snapshots?: readonly BodyTwinSnapshot[] };

const isSubjectsPayload = (value: unknown): value is SubjectsPayload =>
  Boolean(
    value &&
    typeof value === "object" &&
    Array.isArray((value as SubjectsPayload).subjects),
  );

const isScansPayload = (value: unknown): value is ScansPayload =>
  Boolean(
    value && typeof value === "object" && Array.isArray((value as ScansPayload).scans),
  );

const isSnapshotsPayload = (value: unknown): value is SnapshotsPayload =>
  Boolean(
    value &&
    typeof value === "object" &&
    Array.isArray((value as SnapshotsPayload).snapshots),
  );

/**
 * Digital Twin Body twin: subject and scan selectors, GLTFLoader, OrbitControls,
 * Z-up fit, AutoMarkers overlay, scan date and SI property values.
 */
export const BodyLoopAvatar = ({
  preview,
  forceFallback = false,
  onContext,
}: BodyLoopAvatarProps) => {
  const [subjects, setSubjects] = useState<readonly BodyTwinSubject[]>(
    preview?.subjects ?? [],
  );
  const [scans, setScans] = useState<readonly BodyTwinScan[]>(preview?.scans ?? []);
  const [snapshots, setSnapshots] = useState<readonly BodyTwinSnapshot[]>(
    preview?.snapshots ?? [],
  );
  const [chosenSubjectId, setSubjectId] = useState(preview?.selectedSubjectId ?? "");
  // Previews know their subjects up front; live, the list (or its failure) decides.
  const [subjectsReady, setSubjectsReady] = useState(preview !== undefined);
  const [demoSex, setDemoSex] = useState<DemoSex>("male");
  const [demoFailedUrl, setDemoFailedUrl] = useState<string | null>(null);
  const subjectId = chosenSubjectId || (subjectsReady ? defaultSubjectId(subjects) : "");
  const isDemo = isDemoSubject(subjectId);
  const [viatarId, setViatarId] = useState(
    preview?.selectedViatarId !== undefined ? String(preview.selectedViatarId) : "",
  );
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [overlays, setOverlays] = useState<OverlayToggles>(DEFAULT_OVERLAYS);
  const [wantRotate, setWantRotate] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [panel, onPanel] = useReducer(panelReducer, initialPanel);
  const onHover = useCallback((id: string | null) => onPanel({ type: "hover", id }), []);
  const [labelScreen, setLabelScreen] = useState<
    readonly { id: string; text: string; x: number; y: number }[]
  >([]);
  const [savingDefault, setSavingDefault] = useState(false);
  const [defaultError, setDefaultError] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  // Live vitals: on in the environment, off inline until asked (battery on an
  // 8 GB Air), never with reduced motion.
  const [liveInline, setLiveInline] = useState(false);
  const [liveInEnvironment, setLiveInEnvironment] = useState(true);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>(IDLE_STATUS);
  const [scanScene, setScanScene] = useState<Group | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const [glLost, setGlLost] = useState(false);
  const onGlLost = useCallback(() => setGlLost(true), []);
  const onGlFresh = useCallback(() => setGlLost(false), []);
  const idleRef = useRef<number | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const camera = useMemo(() => new PerspectiveCamera(40, 1, 0.01, 40), []);
  const anatomy = useAnatomyView(preview === undefined);
  const motion = useBodyMotion(scanScene, reducedMotion, isDemo ? "demo" : "scan");
  const onControls = useCallback((controls: OrbitControls | null) => {
    controlsRef.current = controls;
  }, []);
  const getControls = useCallback(() => controlsRef.current, []);
  const onDemoError = useCallback((url: string) => setDemoFailedUrl(url), []);
  const onDemoReady = useCallback(
    (url: string) => setDemoFailedUrl((failed) => (failed === url ? null : failed)),
    [],
  );
  const { resolvedTheme } = useTheme();
  // Dark is this design's home; before next-themes resolves, assume it.
  const dark = resolvedTheme !== "light";
  const environment = useEnvironment();
  const { preset, followTime } = environment.state;
  const hour = useLocalHour(environment.active && preset === "outdoors" && followTime);
  const look = useMemo(
    () => (environment.active ? lookFor(preset, dark, followTime ? hour : null) : null),
    [environment.active, preset, dark, followTime, hour],
  );
  const light = look?.light ?? INLINE_LIGHT;
  const zoom = (direction: "in" | "out") => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (direction === "in") controls.dollyIn(ZOOM_STEP);
    else controls.dollyOut(ZOOM_STEP);
    onUserRotate();
  };

  useEffect(() => {
    if (preview !== undefined) return;
    let cancelled = false;
    void fetch("/api/vitronic/subjects")
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (cancelled) return;
        // No BodyLoop connection or no subjects: the demo subject still works.
        const rows = isSubjectsPayload(value) ? (value.subjects ?? []) : [];
        setSubjects(rows);
        setSubjectId(defaultSubjectId(rows));
        setSubjectsReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSubjectId(DEMO_SUBJECT_ID);
        setSubjectsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [preview]);

  useEffect(() => {
    if (preview !== undefined || !subjectId || isDemoSubject(subjectId)) return;
    let cancelled = false;
    void Promise.all([
      fetch(`/api/vitronic/subjects/${subjectId}/scans`).then((response) =>
        response.ok ? response.json() : null,
      ),
      fetch(`/api/vitronic/subjects/${subjectId}/snapshots`).then((response) =>
        response.ok ? response.json() : null,
      ),
    ])
      .then(([scansBody, snapshotsBody]: readonly [unknown, unknown]) => {
        if (cancelled) return;
        const nextScans = isScansPayload(scansBody) ? (scansBody.scans ?? []) : [];
        const nextSnapshots = isSnapshotsPayload(snapshotsBody)
          ? (snapshotsBody.snapshots ?? [])
          : [];
        setScans(nextScans);
        setSnapshots(nextSnapshots);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [preview, subjectId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      const reduced = media.matches;
      setReducedMotion(reduced);
      setWantRotate(initialAutoRotate(reduced));
      setAutoRotate(initialAutoRotate(reduced));
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const onUserRotate = useCallback(() => {
    setAutoRotate(false);
    if (idleRef.current) window.clearTimeout(idleRef.current);
    if (!wantRotate) return;
    idleRef.current = window.setTimeout(() => {
      setAutoRotate(true);
    }, AUTO_ROTATE_IDLE_MS);
  }, [wantRotate]);

  const selectedSubject = subjects.find((row) => row.id === subjectId);
  const subjectKind: "scanner" | "file" =
    selectedSubject?.source === VITRONIC_SUBJECT_SOURCE_SCANNER ||
    selectedSubject?.isSelf === true
      ? "scanner"
      : "file";

  const listedScans = useMemo(
    () => orderScans(mergeScanRows(scans, snapshots, subjectKind)),
    [scans, snapshots, subjectKind],
  );
  const pinnedViatarId = selectedSubject?.defaultViatarId ?? null;
  const shownViatarId =
    viatarId !== ""
      ? viatarId
      : String(pickDefaultScan(listedScans, pinnedViatarId) ?? "");

  const selectedViatar = Number.parseInt(shownViatarId, 10);
  const selectedScan = listedScans.find((row) => row.viatarId === selectedViatar);
  const snapshot = snapshots.find((row) => row.viatarId === selectedViatar);
  const scanState = selectedScan
    ? selectedScan.incomplete
      ? "incomplete"
      : selectedScan.synced
        ? "complete"
        : "missing"
    : snapshot
      ? "incomplete"
      : "missing";
  const scannerActions =
    preview === undefined &&
    subjectKind === "scanner" &&
    subjectId.length > 0 &&
    shownViatarId.length > 0;
  const isPinned = selectedScan !== undefined && selectedScan.viatarId === pinnedViatarId;
  const defaultActions =
    subjectId.length > 0 &&
    selectedScan !== undefined &&
    (isPinned || selectedScan.synced);

  const saveDefault = (next: number | null) => {
    setSavingDefault(true);
    setDefaultError(false);
    void fetch(`/api/vitronic/subjects/${subjectId}/default`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viatarId: next }),
    })
      .then((response) => {
        if (!response.ok) {
          setDefaultError(true);
          return;
        }
        setSubjects((rows) =>
          rows.map((row) =>
            row.id === subjectId ? { ...row, defaultViatarId: next } : row,
          ),
        );
        if (next !== null) setViatarId(String(next));
      })
      .catch(() => setDefaultError(true))
      .finally(() => setSavingDefault(false));
  };
  const syncLabel =
    scanState === "complete"
      ? SCAN_RESYNC
      : scanState === "incomplete"
        ? SCAN_SYNC_AGAIN
        : SCAN_SYNC;
  const properties = snapshot?.properties ?? [];
  const geometry = parseSnapshotGeometry(snapshot ?? {});
  const shownMarkers = visibleMarkers(geometry.markers, overlays);
  const shownMeasures = visibleMeasures(geometry.measures, overlays);
  const readyMesh = snapshot?.hasAvatar === true;
  const webgl = useWebglAvailable();
  const showWebgl = !forceFallback && webgl;
  // With a canvas the panel sits in its rail; without one it stands alone.
  const panelInRail = showWebgl && readyMesh;
  const biomarkerSubject = isDemo ? "demo" : selectedSubject?.isSelf ? "self" : "other";
  const biomarkers = useBiomarkerTab({
    subject: biomarkerSubject,
    enabled: preview === undefined,
    anatomy: anatomy.state,
    dispatch: anatomy.dispatch,
  });
  // G3b: a tap in the environment picks a part, lights it and opens its card.
  const [picked, setPicked] = useState<Picked | null>(null);
  const [anchorStore] = useState(createAnchorStore);
  const scheme = ATLASES[anatomy.state.atlasId].scheme;
  const { dispatch: anatomyDispatch } = anatomy;
  const pickLit = anatomy.state.highlightFrom?.id.startsWith(PICK_PREFIX) === true;
  const onPick = useCallback(
    (next: Picked | null) => {
      setPicked(next);
      const lit = next ? pickHighlight(next.target) : null;
      if (!next || next.target.kind !== "part" || !lit) {
        // The body outline or empty sky replaces a pick; its glow goes with it.
        if (pickLit) anatomyDispatch({ type: "highlight", highlight: null });
        return;
      }
      const highlights = pickHighlights(next.target, scheme);
      anatomyDispatch({
        type: "highlight",
        highlight: lit,
        from: {
          id: `${PICK_PREFIX}${highlightValue(lit)}`,
          label: pickedLabel(next.target.label),
          highlights,
        },
      });
    },
    [scheme, anatomyDispatch, pickLit],
  );
  const viewRef = useRef<HTMLDivElement | null>(null);
  const [viewNode, setViewNode] = useState<HTMLDivElement | null>(null);
  const setView = useCallback((node: HTMLDivElement | null) => {
    viewRef.current = node;
    setViewNode(node);
  }, []);
  const wheelHint = useWheelGate(viewNode, environment.active);
  // Entering or leaving, however it happens (button, Esc, full screen dropped),
  // re-frames the body: the inline view may have been zoomed, the environment walked.
  const wasActiveRef = useRef(environment.active);
  useEffect(() => {
    if (wasActiveRef.current === environment.active) return;
    wasActiveRef.current = environment.active;
    setResetKey((value) => value + 1);
  }, [environment.active]);
  // Closing the card hands focus back to the 3D view, so the keys walk again.
  const closeCard = useCallback(() => {
    setPicked(null);
    viewRef.current?.focus();
  }, []);
  const { live: measuredVitals } = biomarkers;
  // Night playback replaces the newest readings while it is open, inline only.
  const night = useNightPlayback(biomarkerSubject, reducedMotion);
  const nightSynthetic = nightPlaybackFor(biomarkerSubject) === "synthetic";
  const playing = nightSynthetic && night.open && !environment.active;
  const liveVitals = playing ? night.vitals : measuredVitals;
  const liveAvailable =
    !reducedMotion &&
    (measuredVitals.heart !== null ||
      measuredVitals.breath !== null ||
      measuredVitals.hrvBelow !== null);
  const liveOn =
    !reducedMotion &&
    (playing || (liveAvailable && (environment.active ? liveInEnvironment : liveInline)));
  // Primitives only, so the page hears about a change once, not on every render.
  const contextScans = listedScans.length;
  const contextValues = biomarkers.rows.filter((row) => row.value !== null).length;
  const contextLive =
    measuredVitals.heart !== null ||
    measuredVitals.breath !== null ||
    measuredVitals.hrvBelow !== null;
  const contextStatus = biomarkers.status;
  useEffect(() => {
    if (!subjectsReady || !onContext) return;
    onContext({
      subject: biomarkerSubject,
      scans: contextScans,
      biomarkerValues: contextValues,
      biomarkersStatus: contextStatus,
      liveVitals: contextLive,
    });
  }, [
    subjectsReady,
    onContext,
    biomarkerSubject,
    contextScans,
    contextValues,
    contextStatus,
    contextLive,
  ]);
  const linked = useMemo(
    () => (picked ? linkedRows(picked.target, biomarkers.rows, scheme) : []),
    [picked, biomarkers.rows, scheme],
  );
  // HRA parts carry a group key; BodyParts3D parts have none, so they get no line.
  const pickedGroup = picked?.target.kind === "part" ? picked.target.group : null;
  const pickedOrgan =
    biomarkers.organs.find((status) => status.organ === pickedGroup) ?? null;
  // A card describes one part of one body on one atlas; any of those changing closes it.
  const bodyKey = isDemo ? `demo:${demoSex}` : `scan:${shownViatarId}`;
  useEffect(() => {
    setPicked(null);
  }, [environment.active, anatomy.state.atlasId, bodyKey]);
  // Another subject or scan starts with an empty search; the chosen tab stays.
  useEffect(() => {
    onPanel({ type: "query", query: "" });
  }, [subjectId, bodyKey]);
  // A part a toggle or the slider has hidden has no card either.
  const { targetDepth, layers: shownLayers, hiddenSystems } = anatomy.state;
  const pickedShown =
    picked === null ||
    pickVisible(picked.target, targetDepth, shownLayers, hiddenSystems);
  useEffect(() => {
    if (!pickedShown) setPicked(null);
  }, [pickedShown]);
  // The biomarker catalogue counts too: a subject with no scan rows still gets it.
  const hasPanelRows =
    properties.length +
      geometry.markers.length +
      geometry.measures.length +
      biomarkers.rows.length >
    0;
  const bodyPanel = (
    <BodyPanel
      properties={properties}
      markers={shownMarkers}
      measures={shownMeasures}
      selectedId={highlightId}
      onSelect={setHighlightId}
      biomarkers={biomarkers}
      panel={panel}
      onPanel={onPanel}
    />
  );
  const scanMeta = selectedScan
    ? [
        selectedScan.crtime ? selectedScan.crtime.slice(0, 10) : null,
        `scan ${selectedScan.viatarId}`,
        selectedScan.presetName ?? snapshot?.presetName,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  // First paint, before the subject list answers: same line as before the demo existed.
  if (!subjectsReady) {
    return (
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        {BODY_TWIN_LOADING}
      </p>
    );
  }

  const demoBody = DEMO_BODIES[demoBodyIdFor(demoSex)];
  // The rigged bake replaces the static body when installed; until the status
  // answers there is no URL, so the demo body is never loaded twice.
  const demoRigged = anatomy.rigged?.[demoBody.id] === true;
  const demoUrl =
    anatomy.rigged === null && preview === undefined
      ? null
      : demoRigged
        ? riggedBodyApiUrl(demoBody.id)
        : demoBodyApiUrl(demoBody.id);

  const viewport = (body: Readonly<{ kind: "scan" | "demo"; url: string }>) => (
    <div
      className={
        environment.active
          ? "twin-environment-view relative overflow-hidden"
          : "wearables-hero relative h-[min(70vh,640px)] min-h-[360px] overflow-hidden rounded-xl outline-none"
      }
      // In the environment the 3D view takes focus (a click, or Tab) and walks on keys.
      // Inline a click focuses it too, which is what lets the wheel zoom (wheel-zoom.ts).
      ref={setView}
      tabIndex={environment.active ? 0 : -1}
      role={environment.active ? "application" : undefined}
      aria-label={environment.active ? VIEW_LABEL : undefined}
      {...(environment.active ? { [WALK_SURFACE_ATTR]: "" } : {})}
    >
      <Canvas
        key={canvasKey}
        camera={camera}
        frameloop="demand"
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "low-power",
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
        }}
      >
        <ContextLossWatcher onLost={onGlLost} onFresh={onGlFresh} />
        <ScanEnvironment intensity={light.environment} />
        {/* Z-up scene: the sky is +Z, the key is front-top (the body faces -Y), the rim behind.
            The environment changes only colours and intensities, never the light count. */}
        <hemisphereLight
          position={[0, 0, 1]}
          color={0xf2f6ff}
          groundColor={0x3a3a3a}
          intensity={light.hemisphere}
        />
        <directionalLight
          position={[0, -2.4, 3.2]}
          intensity={light.key}
          color={light.keyColor}
        />
        <directionalLight position={[0, 2.5, 1.5]} intensity={light.rim} />
        <BodyScan
          url={body.url}
          kind={body.kind}
          onError={body.kind === "demo" ? onDemoError : undefined}
          onReady={body.kind === "demo" ? onDemoReady : undefined}
          dark={look ? look.world.dark : dark}
          camera={camera}
          showLandmarks={body.kind === "scan" && showLandmarks}
          resetKey={resetKey}
          autoRotate={autoRotate}
          onUserRotate={onUserRotate}
          markers={body.kind === "scan" ? shownMarkers : NO_MARKERS}
          measures={body.kind === "scan" ? shownMeasures : NO_MEASURES}
          highlightId={highlightId ?? panel.hoverId}
          onHover={onHover}
          onLabels={setLabelScreen}
          onScene={setScanScene}
          onControls={onControls}
          world={look?.world ?? null}
          walk={environment.active}
          getControls={getControls}
        />
        <BodyMotion
          binding={motion.binding}
          clip={motion.clip}
          tempo={motion.tempo}
          video={motion.video}
        />
        {environment.active ? (
          <ProjectAnchor point={picked?.point ?? null} store={anchorStore} />
        ) : null}
        <AnatomyLayers
          scanRoot={scanScene}
          statureM={body.kind === "scan" ? snapshotStature(properties) : null}
          atlasId={anatomy.state.atlasId}
          requested={anatomy.state.requested}
          retry={anatomy.state.retry}
          // The atlas cannot follow the bones, so it fades out while the body moves.
          targetDepth={motion.clip ? 0 : anatomy.state.targetDepth}
          layers={anatomy.state.layers}
          hiddenSystems={anatomy.state.hiddenSystems}
          highlight={anatomy.state.highlight}
          reducedMotion={reducedMotion}
          onLoad={anatomy.onLoad}
          onPick={environment.active ? onPick : undefined}
          liveVitals={{ enabled: liveOn, vitals: liveVitals, onStatus: setLiveStatus }}
        />
      </Canvas>
      {glLost ? (
        <div
          role="alert"
          className="bg-card/90 absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm"
        >
          <p>{BODY_VIEW_LOST}</p>
          <Button
            onClick={() => {
              setGlLost(false);
              setCanvasKey((value) => value + 1);
            }}
          >
            {BODY_VIEW_RELOAD}
          </Button>
        </div>
      ) : null}
      {wheelHint ? (
        <p role="status" className="twin-wheel-hint">
          {WHEEL_ZOOM_HINT}
        </p>
      ) : null}
      {body.kind === "scan" && showLandmarks
        ? labelScreen.map((row) => (
            <div
              key={row.id}
              className="pointer-events-none absolute z-10 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"
              style={{
                left: row.x,
                top: row.y,
                transform: "translate(-50%, -120%)",
              }}
            >
              {row.text}
            </div>
          ))
        : null}
    </div>
  );

  // Toolbar and canvas on the left; on lg the rail sits beside them, below lg
  // it stacks directly under the canvas. In the environment the same elements
  // cover the window: the canvas fills it and the toolbar and rail float over
  // it. Only classes change, so the canvas and the panels are never remounted on
  // enter or exit. The move between rail and standalone below does remount the
  // panel; its search and tab live in `panel` here, so they survive it.
  const inEnvironment = environment.active;
  const viewer = (
    body: Readonly<{ kind: "scan" | "demo"; url: string }>,
    rail: Readonly<{ anatomy: ReactNode; details: ReactNode }>,
  ) => (
    <div
      ref={environment.setContainer}
      // Takes focus on a canvas drag, so focus never falls back to the page behind.
      tabIndex={inEnvironment ? -1 : undefined}
      role={inEnvironment ? "dialog" : undefined}
      aria-modal={inEnvironment ? true : undefined}
      aria-label={inEnvironment ? ENVIRONMENT_LABEL : undefined}
      className={
        inEnvironment
          ? "twin-environment"
          : "mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start"
      }
    >
      <div className={inEnvironment ? "contents" : "min-w-0"}>
        <div className={inEnvironment ? "twin-environment-bar" : undefined}>
          <ViewToolbar
            autoRotate={autoRotate}
            onReset={() => setResetKey((value) => value + 1)}
            onToggleRotate={() => {
              const next = !wantRotate;
              setWantRotate(next);
              setAutoRotate(next);
            }}
            onZoom={zoom}
            landmarks={
              body.kind === "scan"
                ? {
                    shown: showLandmarks,
                    onToggle: () => setShowLandmarks((value) => !value),
                  }
                : undefined
            }
            motion={motion.control}
            environment={{ active: inEnvironment, onToggle: environment.toggle }}
            environmentRef={environment.buttonRef}
            liveVitals={
              liveAvailable
                ? {
                    on: liveOn,
                    onToggle: () =>
                      environment.active
                        ? setLiveInEnvironment((on) => !on)
                        : setLiveInline((on) => !on),
                  }
                : undefined
            }
          />
          {inEnvironment ? (
            <EnvironmentPanel
              label={PANEL_TEXT.scene}
              collapsible
              open={environment.state.open.scene}
              onToggle={() => environment.togglePanel("scene")}
            >
              <EnvironmentBar
                shown={environment.state.open.scene}
                preset={preset}
                followTime={followTime}
                onPreset={(next) =>
                  environment.dispatch({ type: "preset", preset: next })
                }
                onFollowTime={() => environment.dispatch({ type: "followTime" })}
              />
            </EnvironmentPanel>
          ) : null}
        </div>
        {viewport(body)}
        {/* Beside the 3D view, not in its role="application", so both read as text.
            Below 640 px in the environment they stack at the bottom (globals.css). */}
        <div className="twin-bottom-stack">
          <LiveLines
            status={liveOn ? liveStatus : IDLE_STATUS}
            vitals={liveVitals}
            scheme={scheme}
            context={{
              on: playing || (environment.active ? liveInEnvironment : liveInline),
              inEnvironment: environment.active,
              reducedMotion,
            }}
            extra={motionLines(motion.control, anatomy.state.targetDepth > 0)}
          />
          {environment.active ? null : nightSynthetic ? (
            <NightPlayback state={night} reducedMotion={reducedMotion} />
          ) : (
            <p className="twin-live-lines">{NIGHT_NEEDS_READINGS}</p>
          )}
          {environment.active && picked ? (
            <PickCard
              picked={picked}
              linked={linked}
              organ={pickedOrgan}
              selectedId={biomarkers.selectedId}
              store={anchorStore}
              onSelectRow={(id) => {
                biomarkers.onSelect(id);
                if (id) environment.openPanel("details");
              }}
              onClose={closeCard}
            />
          ) : null}
        </div>
      </div>
      <div
        className={
          inEnvironment ? "twin-environment-rail" : "flex min-w-0 flex-col gap-3"
        }
      >
        {(["anatomy", "details"] as const).map((panel) => (
          <EnvironmentPanel
            key={panel}
            label={PANEL_TEXT[panel]}
            collapsible={inEnvironment}
            open={environment.state.open[panel]}
            onToggle={() => environment.togglePanel(panel)}
          >
            {rail[panel]}
          </EnvironmentPanel>
        ))}
      </div>
      {inEnvironment ? <ResearchLine /> : null}
    </div>
  );

  return (
    <div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          as="select"
          label="Subject"
          value={subjectId}
          onChange={(event) => {
            setSubjectId(event.target.value);
            setViatarId("");
          }}
        >
          {subjectOptions(subjects).map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </Field>
        {isDemo ? (
          <Field
            as="select"
            label={DEMO_BODY_PICKER}
            value={demoSex}
            onChange={(event) => {
              const next = DEMO_SEXES.find((sex) => sex === event.target.value);
              if (next) setDemoSex(next);
            }}
          >
            {DEMO_SEXES.map((sex) => (
              <option key={sex} value={sex}>
                {DEMO_SEX_LABEL[sex]}
              </option>
            ))}
          </Field>
        ) : (
          <Field
            as="select"
            label="Scan"
            value={shownViatarId}
            onChange={(event) => setViatarId(event.target.value)}
          >
            {listedScans.length === 0 ? <option value="">No scans</option> : null}
            {listedScans.map((row) => (
              <option key={row.viatarId} value={String(row.viatarId)}>
                {scanLabel(row, pinnedViatarId)}
              </option>
            ))}
          </Field>
        )}
      </div>
      {isDemo ? (
        <>
          <p className="text-muted-foreground mt-2 text-xs">{DEMO_BODY_NOTE}</p>
          {demoUrl && demoErrorShown(demoFailedUrl, demoUrl) ? (
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
              {DEMO_LOAD_ERROR}
            </p>
          ) : null}
          {showWebgl ? (
            demoUrl &&
            viewer(
              { kind: "demo", url: demoUrl },
              {
                anatomy: (
                  <AnatomyControls
                    state={anatomy.state}
                    installed={anatomy.installed}
                    dispatch={anatomy.dispatch}
                    onInteract={onUserRotate}
                    envelope="demo"
                  />
                ),
                details: (
                  <BodyPanel
                    properties={[]}
                    markers={NO_MARKERS}
                    measures={NO_MEASURES}
                    selectedId={null}
                    biomarkers={biomarkers}
                    tabs={DEMO_PANEL_TABS}
                    panel={panel}
                    onPanel={onPanel}
                  />
                ),
              },
            )
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">{DEMO_NEEDS_WEBGL}</p>
          )}
          <p className="text-muted-foreground mt-3 text-[11px] leading-relaxed">
            {demoRigged ? RIGGED_ATTRIBUTION : demoBody.attribution}{" "}
            <a
              href={ANNY_CODE_LICENCE_URL}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Apache-2.0
            </a>{" "}
            ·{" "}
            <a
              href={ANNY_SHAPE_LICENCE_URL}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              CC0 1.0
            </a>{" "}
            ·{" "}
            <a
              href={ANNY_PAPER_URL}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              arXiv:2511.03589
            </a>
          </p>
        </>
      ) : (
        <>
          <p className="text-muted-foreground mt-2 text-xs">Label is {LABEL_HINT}.</p>
          {scannerActions || defaultActions ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {scannerActions ? (
                <Button
                  onClick={() => {
                    void fetch(`/api/vitronic/subjects/${subjectId}/sync`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ viatarId: selectedViatar }),
                    }).then(async (response) => {
                      if (!response.ok) return;
                      const [snaps, scanList] = await Promise.all([
                        fetch(`/api/vitronic/subjects/${subjectId}/snapshots`),
                        fetch(`/api/vitronic/subjects/${subjectId}/scans`),
                      ]);
                      const snapBody: unknown = snaps.ok ? await snaps.json() : null;
                      const scanBody: unknown = scanList.ok
                        ? await scanList.json()
                        : null;
                      if (isSnapshotsPayload(snapBody))
                        setSnapshots(snapBody.snapshots ?? []);
                      if (isScansPayload(scanBody)) setScans(scanBody.scans ?? []);
                    });
                  }}
                >
                  {syncLabel}
                </Button>
              ) : null}
              {defaultActions ? (
                <Button
                  disabled={savingDefault}
                  onClick={() => saveDefault(isPinned ? null : selectedViatar)}
                >
                  {isPinned ? SCAN_CLEAR_DEFAULT : SCAN_SET_DEFAULT}
                </Button>
              ) : null}
            </div>
          ) : null}
          {defaultError ? (
            <p className="text-muted-foreground mt-2 text-xs">{SCAN_DEFAULT_FAILED}</p>
          ) : null}
          {listedScans.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
              {BODYLOOP_NO_SCANS}
            </p>
          ) : (
            <>
              {scanMeta ? (
                <p className="text-muted-foreground mt-3 text-xs">{scanMeta}</p>
              ) : null}
              {snapshot && !readyMesh ? (
                <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                  {BODYLOOP_NO_MESH}
                </p>
              ) : null}
              {(readyMesh && snapshot) ||
              geometry.markers.length + geometry.measures.length > 0 ? (
                <>
                  <fieldset className="border-input mt-3 rounded-md border p-2">
                    <legend className="text-muted-foreground px-1 text-xs">View</legend>
                    <div className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-4">
                      {OVERLAY_OPTIONS.map(({ key, label }) => (
                        <label key={key} className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={overlays[key]}
                            onChange={() =>
                              setOverlays((current) => ({
                                ...current,
                                [key]: !current[key],
                              }))
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <Legend items={overlayLegendItems()} className="mt-2 gap-y-1" />
                  </fieldset>
                  {showWebgl && readyMesh && snapshot ? (
                    viewer(
                      { kind: "scan", url: `/api/vitronic/avatar/${snapshot.id}` },
                      {
                        anatomy: (
                          <AnatomyControls
                            state={anatomy.state}
                            installed={anatomy.installed}
                            dispatch={anatomy.dispatch}
                            onInteract={onUserRotate}
                          />
                        ),
                        details: bodyPanel,
                      },
                    )
                  ) : readyMesh ? (
                    <p className="text-muted-foreground mt-3 text-sm">
                      {SCAN_NEEDS_WEBGL}
                    </p>
                  ) : null}
                </>
              ) : null}
            </>
          )}
          {/* Without a mesh the panel stands here, under the selectors. Swapping to a
              scan with one moves it into the rail and remounts it; `panel` keeps
              its search and tab. */}
          {!panelInRail && hasPanelRows ? <div className="mt-3">{bodyPanel}</div> : null}
        </>
      )}
    </div>
  );
};

"use client";

import { useFrame, useThree } from "@react-three/fiber";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
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

import { loadAtlasGltf } from "./anatomy/load-atlas";
import { prepareDemoBody } from "./demo-body";
import { type WorldLook } from "./environment/environment-look";
import { EnvironmentWorld } from "./environment/environment-world";
import { clampToRadius, WALK_RADIUS_M } from "./environment/walk";
import { WalkControls } from "./environment/walk-controls";
import { disposeObject3D } from "./dispose-object";
import { FloorPool } from "./floor-pool";
import { nextAutoRotateDelay } from "./frame-pacing";
import {
  downscaleImage,
  prepareScanMaterials,
  prepareScanTextures,
  releaseImage,
} from "./scan-materials";
import {
  collectLabels,
  OverlayPrimitives,
  ProjectedLabels,
  shouldProjectLabels,
  type visibleMarkers,
  type visibleMeasures,
} from "./scan-overlays";

/** A long pause (tab hidden, canvas off screen) must not turn into one big jump. */
const MAX_ROTATE_DELTA_S = 0.1;

/** The 3D scene parts of the Body twin: camera fit, orbit controls, environment, the scan mesh and WebGL checks. */
export const HIDDEN_NODE_NAMES: ReadonlySet<string> = new Set([
  "AutoMarkers",
  "PalpationMarkers",
  "Analysis_Spine",
]);

export const hiddenOverlayNodes = (root: Object3D): readonly Object3D[] => {
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

export const FitZUpCamera = ({
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

export const ScanOrbitControls = ({
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
export const ScanEnvironment = ({ intensity }: Readonly<{ intensity: number }>) => {
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

export const BodyScan = ({
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
  /** The environment: pans slide along the ground and stay within the walk radius. */
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
        enabled
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

export const probeWebgl = (): boolean => {
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

export const subscribeNever = () => () => undefined;

/** False on the server and during hydration, the cached probe afterwards. */
export const useWebglAvailable = (): boolean =>
  useSyncExternalStore(subscribeNever, probeWebgl, () => false);

/**
 * Reports a lost WebGL context while this canvas is mounted. The listener is
 * removed on unmount, before R3F force-loses the old context on purpose, so a
 * normal unmount never looks like a failure. Mounting means a fresh context.
 */
export const ContextLossWatcher = ({
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

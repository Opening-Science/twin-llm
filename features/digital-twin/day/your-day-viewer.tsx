"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { type Box3, OrthographicCamera, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { DEPTH_MAX } from "@/packages/anatomy/layers";
import { DEFAULT_ATLAS_ID } from "@/packages/anatomy/manifest";

import { AnatomyLayers, type StandaloneAtlasEffects } from "../anatomy/anatomy-layers";
import { type AnatomyLoad } from "../anatomy/anatomy-state";
import { type GlucoseParticlesModel } from "../anatomy/glucose-particles";
import { ContextLossWatcher, useWebglAvailable } from "../scan-scene";
import { YOUR_DAY_COPY } from "../twin-page-copy";
import { YourDayVitalsEffects } from "./replay/your-day-vitals-effects";
import {
  applyYourDayCameraPose,
  yourDayCameraPose,
  yourDayRegionPose,
  type YourDayCameraRequest,
} from "./your-day-camera";

const COPY = YOUR_DAY_COPY.viewer;
const LAYERS = { muscle: true, skeleton: true, organs: true } as const;
const NO_HIDDEN_SYSTEMS = [] as const;

type ViewerEffects = Readonly<{
  playing?: boolean;
  reducedMotion?: boolean;
  bpm?: number | null;
  glucose?: GlucoseParticlesModel | null;
  showVitals?: boolean;
  cameraRequest?: YourDayCameraRequest;
}>;

function ReferenceAtlas({
  onLoad,
  playing = false,
  reducedMotion = false,
  bpm = null,
  glucose = null,
  showVitals = false,
  cameraRequest,
}: ViewerEffects & Readonly<{ onLoad: (load: AnatomyLoad) => void }>) {
  const [box, setBox] = useState<Box3 | null>(null);
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const { width, height } = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const orbitRef = useRef<OrbitControls | null>(null);
  const fittedZoom = useRef<number | null>(null);
  const appliedRequest = useRef<YourDayCameraRequest>(undefined);
  const transition = useRef<{
    from: ReturnType<typeof yourDayCameraPose>;
    to: ReturnType<typeof yourDayRegionPose>;
    elapsed: number;
    duration: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!box || box.isEmpty() || !(camera instanceof OrthographicCamera)) return;
    const center = new Vector3();
    const body = yourDayRegionPose(yourDayCameraPose(camera, center, camera.zoom), box);
    applyYourDayCameraPose(camera, center, camera.zoom, body, body, 1);
    camera.lookAt(center);
    const orbit = new OrbitControls(camera, canvas);
    orbit.target.copy(center);
    const redraw = () => invalidate();
    const cancelTransition = () => {
      transition.current = null;
    };
    orbit.addEventListener("change", redraw);
    orbit.addEventListener("start", cancelTransition);
    orbit.update();
    orbitRef.current = orbit;
    return () => {
      orbit.removeEventListener("change", redraw);
      orbit.removeEventListener("start", cancelTransition);
      orbit.dispose();
      orbitRef.current = null;
      fittedZoom.current = null;
      appliedRequest.current = undefined;
      transition.current = null;
    };
  }, [box, camera, canvas, invalidate]);

  useLayoutEffect(() => {
    const orbit = orbitRef.current;
    if (!orbit || !box || width === 0 || height === 0) return;
    if (!(camera instanceof OrthographicCamera)) return;
    const size = box.getSize(new Vector3());
    const nextFit = 0.9 * Math.min(height / size.y, width / size.x);
    const scale = fittedZoom.current === null ? 1 : camera.zoom / fittedZoom.current;
    fittedZoom.current = nextFit;
    orbit.minZoom = nextFit * 0.5;
    orbit.maxZoom = nextFit * 5;
    Object.assign(camera, { zoom: nextFit * scale });
    camera.updateProjectionMatrix();
    invalidate();
  }, [box, camera, height, invalidate, width]);

  useLayoutEffect(() => {
    const orbit = orbitRef.current;
    const zoom = fittedZoom.current;
    if (
      appliedRequest.current === cameraRequest ||
      !orbit ||
      !box ||
      zoom === null ||
      width === 0 ||
      height === 0 ||
      !(camera instanceof OrthographicCamera)
    )
      return;
    const from = yourDayCameraPose(camera, orbit.target, zoom);
    transition.current = {
      from,
      to: yourDayRegionPose(from, box, cameraRequest?.region),
      elapsed: 0,
      duration: cameraRequest ? 0.65 : 0.85,
    };
    appliedRequest.current = cameraRequest;
    invalidate();
  }, [box, camera, cameraRequest, height, invalidate, width]);

  useLayoutEffect(() => {
    if (reducedMotion && transition.current) invalidate();
  }, [invalidate, reducedMotion]);

  useFrame((_, delta) => {
    const next = transition.current;
    const orbit = orbitRef.current;
    const zoom = fittedZoom.current;
    if (!next || !orbit || zoom === null || !(camera instanceof OrthographicCamera))
      return;
    next.elapsed += Math.min(delta, 0.05);
    const progress = reducedMotion ? 1 : Math.min(next.elapsed / next.duration, 1);
    applyYourDayCameraPose(camera, orbit.target, zoom, next.from, next.to, progress);
    orbit.update();
    if (progress === 1) transition.current = null;
    else invalidate();
  });

  const renderEffects = ({ atlas }: StandaloneAtlasEffects) => (
    <YourDayVitalsEffects
      atlas={atlas}
      playing={playing}
      reducedMotion={reducedMotion}
      bpm={bpm}
      glucose={glucose}
    />
  );
  return (
    <AnatomyLayers
      atlasId={DEFAULT_ATLAS_ID}
      scanRoot={null}
      statureM={null}
      requested
      retry={0}
      targetDepth={DEPTH_MAX}
      layers={LAYERS}
      hiddenSystems={NO_HIDDEN_SYSTEMS}
      highlight={null}
      reducedMotion
      onLoad={onLoad}
      frame="standalone"
      onStandaloneBounds={setBox}
      standaloneEffects={showVitals ? renderEffects : undefined}
    />
  );
}

export const YourDayViewer = memo(function YourDayViewer(effects: ViewerEffects) {
  const webgl = useWebglAvailable();
  const [status, setStatus] = useState<AnatomyLoad["kind"]>("loading");
  const [contextLost, setContextLost] = useState(false);
  const onLoad = useCallback((load: AnatomyLoad) => setStatus(load.kind), []);
  const onLost = useCallback(() => setContextLost(true), []);
  const onFresh = useCallback(() => setContextLost(false), []);
  const message = !webgl
    ? COPY.noWebgl
    : contextLost
      ? COPY.contextLost
      : status === "error"
        ? COPY.failed
        : status === "ready"
          ? null
          : COPY.loading;
  return (
    <div className="wearables-hero relative h-full min-h-98 overflow-hidden rounded-xl sm:min-h-130">
      <div
        role="img"
        aria-label={COPY.label}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
      >
        {webgl && !contextLost && status !== "error" ? (
          <Canvas orthographic frameloop="demand" dpr={[1, 1.5]}>
            <ContextLossWatcher onLost={onLost} onFresh={onFresh} />
            <hemisphereLight intensity={1.6} />
            <directionalLight position={[1, 2, 3]} intensity={2} />
            <ReferenceAtlas onLoad={onLoad} {...effects} />
          </Canvas>
        ) : null}
      </div>
      {message ? (
        <p
          role="status"
          className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-white"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
});

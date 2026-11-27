"use client";

import { Canvas, useThree } from "@react-three/fiber";
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

const COPY = YOUR_DAY_COPY.viewer;
const LAYERS = { muscle: true, skeleton: true, organs: true } as const;
const NO_HIDDEN_SYSTEMS = [] as const;

type ViewerEffects = Readonly<{
  playing?: boolean;
  reducedMotion?: boolean;
  bpm?: number | null;
  glucose?: GlucoseParticlesModel | null;
  showVitals?: boolean;
}>;

function ReferenceAtlas({
  onLoad,
  playing = false,
  reducedMotion = false,
  bpm = null,
  glucose = null,
  showVitals = false,
}: ViewerEffects & Readonly<{ onLoad: (load: AnatomyLoad) => void }>) {
  const [box, setBox] = useState<Box3 | null>(null);
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const { width, height } = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const orbitRef = useRef<OrbitControls | null>(null);
  const fittedZoom = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!box || box.isEmpty() || !(camera instanceof OrthographicCamera)) return;
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    camera.position.set(center.x, center.y, box.max.z + size.y);
    camera.lookAt(center);
    const orbit = new OrbitControls(camera, canvas);
    orbit.target.copy(center);
    const redraw = () => invalidate();
    orbit.addEventListener("change", redraw);
    orbit.update();
    orbitRef.current = orbit;
    return () => {
      orbit.removeEventListener("change", redraw);
      orbit.dispose();
      orbitRef.current = null;
      fittedZoom.current = null;
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

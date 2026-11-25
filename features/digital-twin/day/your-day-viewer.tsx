"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { type Box3, OrthographicCamera, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { DEPTH_MAX } from "@/packages/anatomy/layers";
import { DEFAULT_ATLAS_ID } from "@/packages/anatomy/manifest";

import { AnatomyLayers } from "../anatomy/anatomy-layers";
import { type AnatomyLoad } from "../anatomy/anatomy-state";
import { ContextLossWatcher, useWebglAvailable } from "../scan-scene";

const LAYERS = { muscle: true, skeleton: true, organs: true } as const;
const NO_HIDDEN_SYSTEMS = [] as const;

function ReferenceAtlas({ onLoad }: Readonly<{ onLoad: (load: AnatomyLoad) => void }>) {
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
      onStandaloneBounds={setBox}
    />
  );
}

export function YourDayViewer() {
  const webgl = useWebglAvailable();
  const [status, setStatus] = useState<AnatomyLoad["kind"]>("loading");
  const [contextLost, setContextLost] = useState(false);
  const onLoad = useCallback((load: AnatomyLoad) => setStatus(load.kind), []);
  const onLost = useCallback(() => setContextLost(true), []);
  const onFresh = useCallback(() => setContextLost(false), []);
  const message = !webgl
    ? "The reference atlas needs WebGL."
    : contextLost
      ? "The 3D view lost its WebGL context."
      : status === "error"
        ? "The reference atlas could not be loaded."
        : status === "ready"
          ? null
          : "Loading reference atlas…";
  return (
    <div className="wearables-hero relative h-full min-h-98 overflow-hidden rounded-xl sm:min-h-130">
      <div
        role="img"
        aria-label="Organ-level 3D reference anatomy"
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
      >
        {webgl && !contextLost && status !== "error" ? (
          <Canvas orthographic frameloop="demand" dpr={[1, 1.5]}>
            <ContextLossWatcher onLost={onLost} onFresh={onFresh} />
            <hemisphereLight intensity={1.6} />
            <directionalLight position={[1, 2, 3]} intensity={2} />
            <ReferenceAtlas onLoad={onLoad} />
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
}

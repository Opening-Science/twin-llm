"use client";

import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACESFilmicToneMapping, PerspectiveCamera } from "three";
import { type OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  DEMO_BODIES,
  demoBodyApiUrl,
  demoBodyIdFor,
} from "@/packages/anatomy/demo-bodies";

import {
  HEMISPHERE_GROUND,
  HEMISPHERE_SKY,
  INLINE_LIGHT,
} from "../environment/environment-look";
import { initialAutoRotate } from "../scan-materials";
import { BodyScan, ContextLossWatcher, ScanEnvironment } from "../scan-scene";
import { KIOSK_BODY_MISSING, KIOSK_VIEW_LABEL } from "./kiosk-copy";

const NO_MARKERS: Parameters<typeof BodyScan>[0]["markers"] = [];
const NO_MEASURES: Parameters<typeof BodyScan>[0]["measures"] = [];
const noop = () => undefined;

export type KioskSex = "male" | "female";

type TwinState = "loading" | "ready" | "failed";

/**
 * The kiosk's twin: the synthetic demo body standing full length in a
 * portrait frame, turning slowly. Nothing on it is a person's: the body is
 * ANNY's baked demo mesh, and the view takes no input of its own (the kiosk
 * screen owns every press). It loads the static body, never a scan, and says
 * on `data-state` whether the body has loaded. The kiosk is always dark
 * (`kiosk-screen.tsx`), so the floor is drawn for a dark stage.
 */
export const KioskTwin = ({ sex = "male" }: Readonly<{ sex?: KioskSex }>) => {
  const camera = useMemo(() => new PerspectiveCamera(40, 9 / 16, 0.01, 40), []);
  const controlsRef = useRef<OrbitControls | null>(null);
  const onControls = useCallback((controls: OrbitControls | null) => {
    controlsRef.current = controls;
  }, []);
  const getControls = useCallback(() => controlsRef.current, []);
  const [state, setState] = useState<TwinState>("loading");
  const onError = useCallback(() => setState("failed"), []);
  const onReady = useCallback(() => setState("ready"), []);
  const [canvasKey, setCanvasKey] = useState(0);
  const onLost = useCallback(() => setCanvasKey((key) => key + 1), []);
  const [rotate, setRotate] = useState(true);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setRotate(initialAutoRotate(media.matches));
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const body = DEMO_BODIES[demoBodyIdFor(sex)];

  return (
    <div
      className="kiosk-twin"
      role="img"
      aria-label={KIOSK_VIEW_LABEL}
      data-state={state}
    >
      <Canvas
        key={canvasKey}
        camera={camera}
        frameloop="demand"
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
        }}
      >
        {/* A lost context (a driver reset on a screen that runs all day) remounts the view. */}
        <ContextLossWatcher onLost={onLost} onFresh={noop} />
        <ScanEnvironment intensity={INLINE_LIGHT.environment} />
        <hemisphereLight
          position={[0, 0, 1]}
          color={HEMISPHERE_SKY}
          groundColor={HEMISPHERE_GROUND}
          intensity={INLINE_LIGHT.hemisphere}
        />
        <directionalLight
          position={[0, -2.4, 3.2]}
          intensity={INLINE_LIGHT.key}
          color={INLINE_LIGHT.keyColor}
        />
        <directionalLight position={[0, 2.5, 1.5]} intensity={INLINE_LIGHT.rim} />
        <BodyScan
          url={demoBodyApiUrl(body.id)}
          kind="demo"
          onError={onError}
          onReady={onReady}
          dark
          camera={camera}
          showLandmarks={false}
          resetKey={0}
          autoRotate={rotate}
          onUserRotate={noop}
          markers={NO_MARKERS}
          measures={NO_MEASURES}
          highlightId={null}
          onHover={noop}
          onLabels={noop}
          onScene={noop}
          onControls={onControls}
          world={null}
          walk={false}
          getControls={getControls}
        />
      </Canvas>
      {state === "failed" ? (
        <p className="kiosk-twin-note">{KIOSK_BODY_MISSING}</p>
      ) : null}
    </div>
  );
};

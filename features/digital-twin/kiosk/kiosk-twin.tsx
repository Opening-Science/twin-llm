"use client";

import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACESFilmicToneMapping, type Group, PerspectiveCamera } from "three";
import { type OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  DEMO_BODIES,
  demoBodyApiUrl,
  demoBodyIdFor,
} from "@/packages/anatomy/demo-bodies";
import { ATLASES } from "@/packages/anatomy/manifest";

import { AnatomyLayers } from "../anatomy/anatomy-layers";
import { useAnatomyView } from "../anatomy/use-anatomy-view";
import {
  HEMISPHERE_GROUND,
  HEMISPHERE_SKY,
  INLINE_LIGHT,
} from "../environment/environment-look";
import { initialAutoRotate } from "../scan-materials";
import { BodyScan, ContextLossWatcher, ScanEnvironment } from "../scan-scene";
import { KIOSK_BODY_MISSING, KIOSK_VIEW_LABEL } from "./kiosk-copy";
import { type BeatFocus } from "../day/kiosk/beat-focus";

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
 *
 * With a `focus` the twin goes to that layer and lights that organ or
 * system; without one it is the body alone. The atlas loads with the body,
 * so the first beat does not wait for it.
 */
export const KioskTwin = ({
  sex = "male",
  focus = null,
}: Readonly<{ sex?: KioskSex; focus?: BeatFocus | null }>) => {
  const camera = useMemo(() => new PerspectiveCamera(40, 9 / 16, 0.01, 40), []);
  const controlsRef = useRef<OrbitControls | null>(null);
  const onControls = useCallback((controls: OrbitControls | null) => {
    controlsRef.current = controls;
  }, []);
  const getControls = useCallback(() => controlsRef.current, []);
  const [state, setState] = useState<TwinState>("loading");
  const onError = useCallback(() => setState("failed"), []);
  const onReady = useCallback(() => setState("ready"), []);
  const [scene, setScene] = useState<Group | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const onLost = useCallback(() => setCanvasKey((key) => key + 1), []);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const anatomy = useAnatomyView(true);
  const { dispatch } = anatomy;
  useEffect(() => {
    dispatch({ type: "bodySex", sex });
  }, [dispatch, sex]);
  const scheme = ATLASES[anatomy.state.atlasId].scheme;
  // The twin turns once per focus (the screen keeps one object per beat); the
  // highlight follows the atlas the body's sex picked.
  useEffect(() => {
    dispatch({ type: "depth", depth: focus?.depth ?? 0 });
    dispatch({ type: "highlight", highlight: focus ? focus.highlights[scheme] : null });
  }, [focus, scheme, dispatch]);
  const body = DEMO_BODIES[demoBodyIdFor(sex)];

  return (
    <div
      className="kiosk-twin"
      role="img"
      aria-label={KIOSK_VIEW_LABEL}
      data-state={state}
      data-atlas={anatomy.state.load.kind}
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
          autoRotate={initialAutoRotate(reduced)}
          onUserRotate={noop}
          markers={NO_MARKERS}
          measures={NO_MEASURES}
          highlightId={null}
          onHover={noop}
          onLabels={noop}
          onScene={setScene}
          onControls={onControls}
          world={null}
          walk={false}
          getControls={getControls}
        />
        <AnatomyLayers
          scanRoot={scene}
          statureM={null}
          atlasId={anatomy.state.atlasId}
          requested
          retry={anatomy.state.retry}
          targetDepth={anatomy.state.targetDepth}
          layers={anatomy.state.layers}
          hiddenSystems={anatomy.state.hiddenSystems}
          highlight={anatomy.state.highlight}
          reducedMotion={reduced}
          onLoad={anatomy.onLoad}
        />
      </Canvas>
      {state === "failed" ? (
        <p className="kiosk-twin-note">{KIOSK_BODY_MISSING}</p>
      ) : null}
    </div>
  );
};

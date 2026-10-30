"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  Box3,
  Color,
  type Material,
  type Matrix4,
  type Mesh,
  type Object3D,
  Vector3,
} from "three";

import { partsFor, type Highlight } from "@/packages/anatomy/highlight";
import { type AtlasScheme } from "@/packages/anatomy/manifest";
import { type OrganSystem, type SystemId } from "@/packages/anatomy/systems";
import { VITAL_ANATOMY } from "@/packages/biomarkers/vitals";

import { setLiveGlow } from "../anatomy/layer-material";
import { nextAutoRotateDelay } from "../frame-pacing";
import { setHeartChambers } from "./heart-chambers";
import {
  advanceClock,
  type BeatClock,
  type BeatPattern,
  chamberContraction,
  rhythmNow,
  startClock,
} from "./heart-cycle";
import { type LiveVitals } from "./live-rates";
import {
  BREATH_GLOW_BODYPARTS3D,
  breathAt,
  chamberGlow,
  HEART_GLOW,
  HEART_SCALE,
  HRV_GLOW,
  LUNG_SCALE,
  pulseAt,
  scaleAbout,
} from "./live-motion";

type LivePart = Readonly<{
  mesh: Mesh;
  group: string | null;
  system: OrganSystem;
}>;

/** What is moving or glowing now, for the lines beside the view. */
export type LiveStatus = Readonly<{
  pulsing: boolean;
  breathing: boolean;
  glowing: boolean;
  /** The heart chambers beat in sequence (#53), and what the atria are doing. */
  chambers: "sinus" | "af" | null;
}>;

export const IDLE_STATUS: LiveStatus = {
  pulsing: false,
  breathing: false,
  glowing: false,
  chambers: null,
};

/** Frames asked for while the heart chambers beat: an atrial beat lasts about 0.1 s. */
export const HEART_CHAMBERS_FPS = 60;

const PULSE_COLOUR = new Color("#ffd9cf");
const HRV_COLOUR = new Color("#9cc2ff");
const BREATH_COLOUR = new Color("#cfe6ff");

/** HRA lights organ groups; BodyParts3D, one mesh per system, only whole systems. */
const targetFor = (
  scheme: AtlasScheme,
  groups: readonly string[],
  system: SystemId,
): Highlight =>
  scheme === "hra" ? { kind: "groups", ids: groups } : { kind: "system", ids: [system] };

/** The parts each cue moves, from G0's vitals table. */
export const liveTargets = <P extends LivePart>(
  scheme: AtlasScheme,
  parts: readonly P[],
): Readonly<{ heart: readonly P[]; lungs: readonly P[]; hrv: readonly P[] }> => ({
  heart: partsFor(
    targetFor(scheme, VITAL_ANATOMY.heartRate.hraGroups, "cardiovascular"),
    parts,
  ),
  lungs: partsFor(targetFor(scheme, ["lung"], "respiratory"), parts),
  hrv: partsFor(targetFor(scheme, VITAL_ANATOMY.hrv.hraGroups, "nervous"), parts),
});

/** A mesh's own transform, kept while it is scaled, so it is restored exactly. */
type Rest = Readonly<{ matrix: Matrix4; auto: boolean; centre: Vector3 }>;
const rests = new WeakMap<Mesh, Rest>();

const restOf = (mesh: Mesh): Rest => {
  const known = rests.get(mesh);
  if (known) return known;
  mesh.updateMatrix();
  // three caches the box on the geometry; computing it once is what three does itself.
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox ?? new Box3();
  const rest = {
    matrix: mesh.matrix.clone(),
    auto: mesh.matrixAutoUpdate,
    centre: box.getCenter(new Vector3()),
  };
  rests.set(mesh, rest);
  return rest;
};

/** Scales a mesh about its centre; 1 puts its own transform back. */
export const setPartScale = (mesh: Mesh, scale: number): void => {
  if (scale === 1) {
    const rest = rests.get(mesh);
    if (!rest) return;
    rests.delete(mesh);
    // The mesh's transform is a three.js object; restored in place.
    mesh.matrix.copy(rest.matrix);
    Object.assign(mesh, { matrixAutoUpdate: rest.auto, matrixWorldNeedsUpdate: true });
    return;
  }
  const rest = restOf(mesh);
  mesh.matrix.copy(scaleAbout(rest.matrix, rest.centre, scale));
  // While scaled the matrix is set by hand, so three must not rebuild it from position/scale.
  Object.assign(mesh, { matrixAutoUpdate: false, matrixWorldNeedsUpdate: true });
};

const drawn = (parts: readonly LivePart[]): boolean =>
  parts.some((part) => part.mesh.visible);

/**
 * The live twin inside the canvas: a heartbeat on the heart at the measured
 * heart rate, a slow breath on the lungs at the measured respiratory rate,
 * and a steady soft glow on the nervous system when HRV is below this
 * person's usual level. Frames stay on demand: a timer asks for about 30 fps
 * only while a moving part is drawn, the canvas is on screen and the tab is
 * visible. Everything is restored when it stops. Renders nothing.
 */
export const LiveConditioning = ({
  enabled,
  vitals,
  scheme,
  parts,
  root,
  chambers,
  onStatus,
}: Readonly<{
  /** Off inline unless asked, on in the environment, never with reduced motion. */
  enabled: boolean;
  vitals: LiveVitals;
  scheme: AtlasScheme;
  parts: readonly LivePart[];
  /** The atlas root: its frame says which way is up, front and left on the heart. */
  root: Object3D;
  /**
   * The heart chambers (#53): on, the HRA heart's atrial then ventricular
   * region contracts on `pattern`'s beats; off, it swells as one.
   */
  chambers: Readonly<{ on: boolean; pattern: BeatPattern }>;
  onStatus: (status: LiveStatus) => void;
}>) => {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const targets = useMemo(() => liveTargets(scheme, parts), [scheme, parts]);
  const visibleRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const statusRef = useRef<LiveStatus>(IDLE_STATUS);
  const clockRef = useRef<BeatClock | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const live = useRef({ enabled, vitals, targets, onStatus, chambers, root });
  useEffect(() => {
    live.current = { enabled, vitals, targets, onStatus, chambers, root };
  });
  // Another beat pattern (person, day) starts its own clock.
  useEffect(() => {
    clockRef.current = null;
  }, [chambers.pattern]);

  const report = (next: LiveStatus) => {
    const now = statusRef.current;
    if (
      now.pulsing === next.pulsing &&
      now.breathing === next.breathing &&
      now.glowing === next.glowing &&
      now.chambers === next.chambers
    ) {
      return;
    }
    statusRef.current = next;
    live.current.onStatus(next);
  };

  // Off screen or in a hidden tab, the timer stops; coming back asks for one frame.
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) invalidate();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            const visible = entries.some((entry) => entry.isIntersecting);
            if (visible && !visibleRef.current) invalidate();
            visibleRef.current = visible;
          });
    observer?.observe(gl.domElement);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
    };
  }, [gl, invalidate]);

  // Any change of input gets one frame, which starts or stops the loop.
  useEffect(() => {
    invalidate();
  }, [enabled, vitals, targets, chambers.on, invalidate]);

  // Leaving (atlas switch, unmount) puts every part back.
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      for (const part of [...targets.heart, ...targets.lungs, ...targets.hrv]) {
        // Scale, chambers and glow, whichever this atlas used.
        setPartScale(part.mesh, 1);
        setHeartChambers(part.mesh, root, null);
        setLiveGlow(part.mesh.material as Material, 0, PULSE_COLOUR);
      }
      statusRef.current = IDLE_STATUS;
      live.current.onStatus(IDLE_STATUS);
    },
    [targets, root],
  );

  useFrame(() => {
    const {
      enabled: on,
      vitals: rates,
      targets: now,
      chambers: chamberSetting,
      root: atlasRoot,
    } = live.current;
    const heart = on && rates.heart !== null && drawn(now.heart);
    const lungs = on && rates.breath !== null && drawn(now.lungs);
    const glowing = on && rates.hrvBelow !== null && drawn(now.hrv);
    const nowMs = performance.now();
    const t = nowMs / 1000;
    const dt = lastFrameRef.current === null ? 0 : (nowMs - lastFrameRef.current) / 1000;
    lastFrameRef.current = nowMs;

    // BodyParts3D has no heart mesh of its own, so chambers are HRA only.
    const beating = heart && rates.heart && scheme === "hra" && chamberSetting.on;
    const clock =
      beating && rates.heart
        ? clockRef.current === null
          ? startClock(rates.heart.perMinute, chamberSetting.pattern)
          : advanceClock(
              clockRef.current,
              dt,
              rates.heart.perMinute,
              chamberSetting.pattern,
            )
        : null;
    clockRef.current = clock;
    const contraction = clock ? chamberContraction(clock, chamberSetting.pattern) : null;

    const beat =
      contraction === null && heart && rates.heart
        ? pulseAt(t, rates.heart.perMinute)
        : 0;
    const glow =
      contraction !== null
        ? chamberGlow(contraction.atria, contraction.ventricles)
        : beat * HEART_GLOW[scheme];
    for (const part of now.heart) {
      // BodyParts3D's cardiovascular mesh is the whole system: glow only, softer.
      setPartScale(part.mesh, scheme === "hra" && beat > 0 ? 1 + HEART_SCALE * beat : 1);
      setHeartChambers(part.mesh, atlasRoot, contraction);
      setLiveGlow(part.mesh.material as Material, glow, PULSE_COLOUR);
    }
    const breath = lungs && rates.breath ? breathAt(t, rates.breath.perMinute) : 0;
    for (const part of now.lungs) {
      // BodyParts3D's respiratory mesh has the nose and airways too; scaling it
      // about the chest would move the nose, so it glows instead.
      if (scheme === "hra") {
        setPartScale(part.mesh, lungs ? 1 + LUNG_SCALE * breath : 1);
      } else {
        setLiveGlow(
          part.mesh.material as Material,
          breath * BREATH_GLOW_BODYPARTS3D,
          BREATH_COLOUR,
        );
      }
    }
    for (const part of now.hrv) {
      setLiveGlow(part.mesh.material as Material, glowing ? HRV_GLOW : 0, HRV_COLOUR);
    }
    report({
      pulsing: heart,
      breathing: lungs,
      glowing,
      chambers: clock ? rhythmNow(clock, chamberSetting.pattern) : null,
    });

    if (!(heart || lungs)) lastFrameRef.current = null;
    if (!(heart || lungs) || timerRef.current !== null) return;
    const wait = nextAutoRotateDelay({
      lastDrawMs: performance.now(),
      nowMs: performance.now(),
      visible: visibleRef.current && !document.hidden,
      ...(clock ? { intervalMs: 1000 / HEART_CHAMBERS_FPS } : {}),
    });
    if (wait === null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      invalidate();
    }, wait);
  });

  return null;
};

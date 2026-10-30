"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

import { nextAutoRotateDelay } from "../frame-pacing";
import {
  type ClipRates,
  clipPose,
  clipRate,
  GENERIC_RATES,
  retimeRate,
} from "./clip-pose";
import { DEFAULT_TEMPO, retimeElapsed } from "./dance";
import { createFootPlanter } from "./foot-contact";
import { type MotionClip, stepWeight, weighPose } from "./gait";
import { type KeyframeClip } from "./keyframe-clip";
import { applyPose, restorePose, type RigBinding } from "./rig-map";

/** Longer gaps (a hidden tab, a stall) do not jump the blend. */
const MAX_DELTA_S = 0.1;
/** While the body moves, frames are asked for at a 60 Hz display's full rate. */
export const MOTION_FRAME_MS = 1000 / 60;

/**
 * Plays a motion clip on the body's skeleton inside the canvas, by setting
 * bone rotations in the frame loop (no AnimationMixer: the clips are functions
 * of time, not keyframes). A clip blends in and out over 0.4 s. Frames stay on
 * demand: while the body moves, a timer asks for about 30 fps, and none while
 * the canvas is off screen or the tab is hidden. Stopping, a new body or
 * unmounting puts every bone back where it was bound. A new tempo carries the
 * dance on from the beat it had reached, and a new cadence or breathing rate
 * from a wearable day (`rates`) carries the clip on from its phase. The
 * "video" clip plays `video`, the installed keyframe clip, and holds its
 * planted feet on the floor (`foot-contact.ts`). Renders nothing.
 */
export const BodyMotion = ({
  binding,
  clip,
  tempo = DEFAULT_TEMPO,
  video = null,
  rates = GENERIC_RATES,
}: Readonly<{
  binding: RigBinding | null;
  clip: MotionClip | null;
  tempo?: number;
  video?: KeyframeClip | null;
  rates?: ClipRates;
}>) => {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const visibleRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const motion = useRef({
    weight: 0,
    playing: null as MotionClip | null,
    startS: 0,
    lastS: null as number | null,
    tempo,
    rate: null as number | null,
  });
  const live = useRef({ binding, clip, tempo, video, rates });
  const planter = useRef(createFootPlanter());
  useEffect(() => {
    live.current = { binding, clip, tempo, video, rates };
  });

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

  // A change of clip gets one frame, which starts or stops the loop.
  useEffect(() => {
    invalidate();
  }, [clip, invalidate]);

  // A new body, or leaving: the old skeleton goes back to its bind pose.
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      if (binding) restorePose(binding);
      planter.current.reset();
      motion.current = {
        weight: 0,
        playing: null,
        startS: 0,
        lastS: null,
        tempo: live.current.tempo,
        rate: null,
      };
    },
    [binding],
  );

  useFrame(() => {
    const {
      binding: rig,
      clip: wanted,
      tempo: wantedTempo,
      video: keyframes,
      rates: wantedRates,
    } = live.current;
    const state = motion.current;
    if (!rig) return;
    const nowS = performance.now() / 1000;
    const delta = state.lastS === null ? 0 : Math.min(MAX_DELTA_S, nowS - state.lastS);
    state.lastS = nowS;
    if (state.tempo !== wantedTempo) {
      state.startS = nowS - retimeElapsed(nowS - state.startS, state.tempo, wantedTempo);
      state.tempo = wantedTempo;
    }
    if (state.playing === null && wanted !== null) {
      state.playing = wanted;
      state.startS = nowS;
      state.rate = clipRate(wanted, wantedRates);
    }
    const rate = state.playing === null ? null : clipRate(state.playing, wantedRates);
    if (state.rate !== null && rate !== null && state.rate !== rate) {
      state.startS = nowS - retimeRate(nowS - state.startS, state.rate, rate);
    }
    state.rate = rate;
    // Stopping, or switching clips, blends the current one out first.
    const target = wanted !== null && wanted === state.playing ? 1 : 0;
    state.weight = stepWeight(state.weight, target, delta);
    if (state.weight === 0 && target === 0) {
      restorePose(rig);
      planter.current.reset();
      state.playing = wanted;
      state.startS = nowS;
      state.rate = wanted === null ? null : clipRate(wanted, wantedRates);
    }
    if (state.playing === null) {
      state.lastS = null;
      return;
    }
    const pose = weighPose(
      clipPose(state.playing, nowS - state.startS, state.tempo, keyframes, wantedRates),
      state.weight,
    );
    applyPose(rig, pose);
    planter.current.plant(rig, pose);

    if (timerRef.current !== null) return;
    const wait = nextAutoRotateDelay({
      lastDrawMs: performance.now(),
      nowMs: performance.now(),
      visible: visibleRef.current && !document.hidden,
      intervalMs: MOTION_FRAME_MS,
    });
    if (wait === null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      invalidate();
    }, wait);
  });

  return null;
};

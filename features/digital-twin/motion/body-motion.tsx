"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

import { nextAutoRotateDelay } from "../frame-pacing";
import { clipPose, type MotionClip, stepWeight, weighPose } from "./gait";
import { applyPose, restorePose, type RigBinding } from "./rig-map";

/** Longer gaps (a hidden tab, a stall) do not jump the blend. */
const MAX_DELTA_S = 0.1;

/**
 * Plays a motion clip on the body's skeleton inside the canvas, by setting
 * bone rotations in the frame loop (no AnimationMixer: the clips are functions
 * of time, not keyframes). A clip blends in and out over 0.4 s. Frames stay on
 * demand: while the body moves, a timer asks for about 30 fps, and none while
 * the canvas is off screen or the tab is hidden. Stopping, a new body or
 * unmounting puts every bone back where it was bound. Renders nothing.
 */
export const BodyMotion = ({
  binding,
  clip,
}: Readonly<{ binding: RigBinding | null; clip: MotionClip | null }>) => {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const visibleRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const motion = useRef({
    weight: 0,
    playing: null as MotionClip | null,
    startS: 0,
    lastS: null as number | null,
  });
  const live = useRef({ binding, clip });
  useEffect(() => {
    live.current = { binding, clip };
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
      motion.current = { weight: 0, playing: null, startS: 0, lastS: null };
    },
    [binding],
  );

  useFrame(() => {
    const { binding: rig, clip: wanted } = live.current;
    const state = motion.current;
    if (!rig) return;
    const nowS = performance.now() / 1000;
    const delta = state.lastS === null ? 0 : Math.min(MAX_DELTA_S, nowS - state.lastS);
    state.lastS = nowS;
    if (state.playing === null && wanted !== null) {
      state.playing = wanted;
      state.startS = nowS;
    }
    // Stopping, or switching clips, blends the current one out first.
    const target = wanted !== null && wanted === state.playing ? 1 : 0;
    state.weight = stepWeight(state.weight, target, delta);
    if (state.weight === 0 && target === 0) {
      restorePose(rig);
      state.playing = wanted;
      state.startS = nowS;
    }
    if (state.playing === null) {
      state.lastS = null;
      return;
    }
    applyPose(rig, weighPose(clipPose(state.playing, nowS - state.startS), state.weight));

    if (timerRef.current !== null) return;
    const wait = nextAutoRotateDelay({
      lastDrawMs: performance.now(),
      nowMs: performance.now(),
      visible: visibleRef.current && !document.hidden,
    });
    if (wait === null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      invalidate();
    }, wait);
  });

  return null;
};

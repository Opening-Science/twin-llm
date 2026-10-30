"use client";

import { useEffect, useMemo, useState } from "react";
import { type Object3D } from "three";

import { type ClipRates, GENERIC_RATES } from "./clip-pose";
import { clampTempo, DEFAULT_TEMPO } from "./dance";
import { type DayPlan } from "./day-motion";
import { type MotionClip } from "./gait";
import { type KeyframeClip, parseKeyframeClip } from "./keyframe-clip";
import { clipInstalled } from "./motion-clips";
import { MOTION_NO_RIG_DEMO, MOTION_NO_RIG_SCAN, MOTION_REDUCED } from "./motion-copy";
import { bindRig, type RigBinding } from "./rig-map";

/** The computed clips, always offered, in toolbar order. */
export const COMPUTED_CLIPS: readonly MotionClip[] = ["walk", "run", "idle", "dance"];

/** The clips the toolbar offers: the computed ones, and the video clip once it has loaded. */
export const offeredClips = (video: KeyframeClip | null): readonly MotionClip[] =>
  video ? [...COMPUTED_CLIPS, "video"] : COMPUTED_CLIPS;

export type MotionControl = Readonly<{
  clip: MotionClip | null;
  /** The clips to offer, in order. */
  clips: readonly MotionClip[];
  onSelect: (clip: MotionClip | null) => void;
  /** Why the clips cannot play here, or null when they can. */
  unavailable: string | null;
  /** The dance's beats a minute. */
  tempo: number;
  onTempo: (tempo: number) => void;
  /** While the twin follows a wearable day: that day's lines, in place of the clip's own. */
  dayLines: readonly string[] | null;
}>;

/** The wearable day the twin follows, if any (`use-day-motion.ts`). */
export type FollowedDay = Readonly<{
  plan: DayPlan | null;
  lines: readonly string[] | null;
  /** A toolbar clip was pressed: the day stops being followed. */
  onManual: () => void;
}>;

const NOT_FOLLOWING: FollowedDay = { plan: null, lines: null, onManual: () => undefined };

/** The rates a followed day sets; generic otherwise. */
export const dayRates = (plan: DayPlan | null): ClipRates =>
  plan
    ? { cadence: plan.cadence, breathsPerMinute: plan.breathsPerMinute }
    : GENERIC_RATES;

/** Why nothing can move, or null when a clip can play. */
export const motionUnavailable = (
  hasRig: boolean,
  reducedMotion: boolean,
  envelope: "scan" | "demo",
): string | null => {
  if (reducedMotion) return MOTION_REDUCED;
  if (!hasRig) return envelope === "demo" ? MOTION_NO_RIG_DEMO : MOTION_NO_RIG_SCAN;
  return null;
};

/**
 * The video clip installed on this machine, if any: the status first, so a
 * machine without one makes no request that 404s, then the clip, parsed and
 * checked. A failure is logged and leaves the clip out of the toolbar.
 */
export const useVideoClip = (enabled: boolean): KeyframeClip | null => {
  const [clip, setClip] = useState<KeyframeClip | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await fetch("/api/motion/status");
        if (!status.ok || !clipInstalled(await status.json(), "video-dance")) return;
        const response = await fetch("/api/motion/clip/video-dance");
        if (!response.ok) return;
        const parsed = parseKeyframeClip(await response.json(), (message) =>
          console.error(`[motion] video clip rejected: ${message}`),
        );
        if (!cancelled) setClip(parsed);
      } catch (error) {
        console.error("[motion] video clip could not be loaded", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return clip;
};

/**
 * Motion state for the Body twin: the skeleton binding of the loaded body (made
 * once, while it is at rest) and the chosen clip. A clip belongs to one body,
 * so a new body starts still; reduced motion or a body without a known rig
 * plays nothing. The dance tempo is kept across bodies. A followed wearable
 * day (#52) picks the clip and its rates instead of the toolbar, until a
 * toolbar clip is pressed. `control` is undefined until a body has loaded.
 */
export const useBodyMotion = (
  scene: Object3D | null,
  reducedMotion: boolean,
  envelope: "scan" | "demo",
  day: FollowedDay = NOT_FOLLOWING,
) => {
  const binding = useMemo<RigBinding | null>(
    () => (scene ? bindRig(scene) : null),
    [scene],
  );
  const [chosen, setChosen] = useState<
    Readonly<{ scene: Object3D | null; clip: MotionClip | null }>
  >({ scene: null, clip: null });
  const [tempo, setTempo] = useState(DEFAULT_TEMPO);
  const video = useVideoClip(scene !== null);
  const clips = offeredClips(video);
  const unavailable = motionUnavailable(binding !== null, reducedMotion, envelope);
  const picked = unavailable === null && chosen.scene === scene ? chosen.clip : null;
  const followed = unavailable === null ? day.plan : null;
  const clip = followed
    ? followed.clip
    : picked !== null && clips.includes(picked)
      ? picked
      : null;
  const control: MotionControl | undefined = scene
    ? {
        clip,
        clips,
        onSelect: (next) => {
          day.onManual();
          setChosen({ scene, clip: next });
        },
        unavailable,
        tempo,
        onTempo: (next) => setTempo(clampTempo(next)),
        dayLines: followed ? day.lines : null,
      }
    : undefined;
  /** Following a day starts from no toolbar clip, so stopping leaves the body still. */
  const clearManual = () => setChosen({ scene, clip: null });
  return { binding, clip, tempo, video, rates: dayRates(followed), control, clearManual };
};

"use client";

import { useEffect, useMemo, useState } from "react";
import { type Object3D } from "three";

import { clampTempo, DEFAULT_TEMPO } from "./dance";
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
}>;

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
 * plays nothing. The dance tempo is kept across bodies. `control` is undefined
 * until a body has loaded.
 */
export const useBodyMotion = (
  scene: Object3D | null,
  reducedMotion: boolean,
  envelope: "scan" | "demo",
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
  const clip = picked !== null && clips.includes(picked) ? picked : null;
  const control: MotionControl | undefined = scene
    ? {
        clip,
        clips,
        onSelect: (next) => setChosen({ scene, clip: next }),
        unavailable,
        tempo,
        onTempo: (next) => setTempo(clampTempo(next)),
      }
    : undefined;
  return { binding, clip, tempo, video, control };
};

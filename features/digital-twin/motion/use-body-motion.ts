"use client";

import { useMemo, useState } from "react";
import { type Object3D } from "three";

import { clampTempo, DEFAULT_TEMPO } from "./dance";
import { type MotionClip } from "./gait";
import { MOTION_NO_RIG_DEMO, MOTION_NO_RIG_SCAN, MOTION_REDUCED } from "./motion-copy";
import { bindRig, type RigBinding } from "./rig-map";

export type MotionControl = Readonly<{
  clip: MotionClip | null;
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
  const unavailable = motionUnavailable(binding !== null, reducedMotion, envelope);
  const clip = unavailable === null && chosen.scene === scene ? chosen.clip : null;
  const control: MotionControl | undefined = scene
    ? {
        clip,
        onSelect: (next) => setChosen({ scene, clip: next }),
        unavailable,
        tempo,
        onTempo: (next) => setTempo(clampTempo(next)),
      }
    : undefined;
  return { binding, clip, tempo, control };
};

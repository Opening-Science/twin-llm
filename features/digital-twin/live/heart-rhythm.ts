import {
  recordingConfigFor,
  rhythmProfileOf,
} from "@/packages/query-tools/rhythm-recording";
import { simulateRecording } from "@/packages/rhythm-sim/simulate-recording";

import { type BeatPattern, patternFromRecording, REGULAR_PATTERN } from "./heart-cycle";

/**
 * Where the beat timing of the heart chambers comes from (#53). A synthetic
 * person gets a recording from packages/rhythm-sim, planned exactly as the
 * `rhythm_irregularity` tool plans one (`recordingConfigFor`): sinus rhythm
 * with its beat-to-beat variation, or paroxysmal AF when the person's record
 * lists atrial fibrillation on the day of the heart rate. Personal data has a
 * rate but no beat times, so its beats are regular.
 */
export type HeartRhythmSource =
  | Readonly<{
      kind: "simulated";
      subjectRef: string;
      /** The day of the heart rate shown, YYYY-MM-DD: the recording day. */
      day: string;
      /** The record lists atrial fibrillation (SNOMED CT 49436004) on that day. */
      afOnDay: boolean;
    }>
  | Readonly<{ kind: "measured" }>;

/** Two minutes: long enough for a paroxysmal episode and the sinus beats around it. */
export const HEART_RECORDING_SEC = 120;
/** Which of the day's recordings; any fixed number keeps it the same on every visit. */
export const HEART_RECORDING = 1;

export type HeartRhythm = Readonly<{
  pattern: BeatPattern;
  /** "regular" for measured data; otherwise the simulated profile. */
  timing: "regular" | "sinus" | "paroxysmal_af";
}>;

export const heartRhythmOf = (source: HeartRhythmSource): HeartRhythm => {
  if (source.kind === "measured") return { pattern: REGULAR_PATTERN, timing: "regular" };
  const plan = {
    subjectRef: source.subjectRef,
    recording: HEART_RECORDING,
    durationSec: HEART_RECORDING_SEC,
    date: source.day,
    afConditionActive: source.afOnDay,
  };
  const config = recordingConfigFor(plan);
  const recording = simulateRecording(config);
  return {
    pattern: patternFromRecording(
      recording.rrMs,
      recording.labels,
      60_000 / recording.config.meanHr,
    ),
    timing: rhythmProfileOf(plan.subjectRef, plan.afConditionActive),
  };
};

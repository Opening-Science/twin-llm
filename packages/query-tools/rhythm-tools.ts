import "server-only";

import { type BeatLabel } from "@/packages/rhythm-sim/ectopic-beats";
import { simulateRecording } from "@/packages/rhythm-sim/simulate-recording";
import type { z } from "zod";

import { defaultQueryToolPorts, type QueryToolPorts } from "./ports";
import { NO_RHYTHM_DATA, tooFewBeats, type ToolRefusal } from "./refusals";
import {
  recordingConfigFor,
  type RhythmProfile,
  rhythmProfileOf,
} from "./rhythm-recording";
import type { rhythmIrregularityInput } from "./schemas";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import {
  beatWindows,
  IRREGULARITY_THRESHOLDS,
  type IrregularityWindow,
  irregularityWindow,
} from "./stats";
import { audited, subjectInScope } from "./tool-core";

/**
 * `rhythm_irregularity` (#246): irregularity metrics of one simulated RR
 * recording of a synthetic subject, made by packages/rhythm-sim (see
 * rhythm-recording.ts for why it is made, not read). It describes the
 * recording; it never says a person has a condition.
 */
export type RhythmIrregularityInput = z.infer<typeof rhythmIrregularityInput>;

export const RESEARCH_THRESHOLD_LABEL =
  "research threshold (Dash et al. 2009, Ann Biomed Eng 37:1701-1709): nRMSSD > 0.1, Shannon entropy > 0.7 and turning-point ratio within the band of random values, per 128 intervals after dropping the 8 longest and 8 shortest; a research threshold, not a diagnosis";

export type RhythmWindow = IrregularityWindow &
  Readonly<{ start_sec: number; end_sec: number }>;

export type RhythmIrregularityResult = Readonly<{
  subject_ref: string;
  recording: number;
  duration_sec: number;
  source: "simulated";
  /** RR intervals in the recording. */
  n: number;
  mean_hr: number;
  window_beats: number;
  n_windows: number;
  n_flagged: number;
  /** Seconds in flagged windows over seconds in all windows. */
  flagged_time_share: number;
  windows: readonly RhythmWindow[];
  threshold: string;
  /** What the simulator made: its settings, never a finding about a person. */
  simulator_ground_truth: Readonly<{
    profile: RhythmProfile;
    af_interval_share: number;
    pac: number;
    pvc: number;
    note: string;
  }>;
}>;

const countOf = (labels: readonly BeatLabel[], label: BeatLabel): number =>
  labels.filter((each) => each === label).length;

/** The metrics of one simulated recording. Pure; the tool wraps it in scope and audit. */
export const describeRecording = (
  input: RhythmIrregularityInput,
): RhythmIrregularityResult | ToolRefusal => {
  const recording = simulateRecording(
    recordingConfigFor(input.subject_ref, input.recording, input.duration_sec),
  );
  const size = IRREGULARITY_THRESHOLDS.windowBeats;
  const windows = beatWindows(recording.rrMs, size).map((rr, index) => ({
    start_sec: recording.beatTimesMs[index * size] / 1000,
    end_sec: recording.beatTimesMs[(index + 1) * size] / 1000,
    ...irregularityWindow(rr),
  }));
  if (windows.length === 0) return tooFewBeats(size, recording.rrMs.length);
  const seconds = (each: RhythmWindow) => each.end_sec - each.start_sec;
  const flagged = windows.filter((each) => each.flagged);
  const total = windows.reduce((sum, each) => sum + seconds(each), 0);
  return {
    subject_ref: input.subject_ref,
    recording: input.recording,
    duration_sec: input.duration_sec,
    source: "simulated",
    n: recording.rrMs.length,
    mean_hr: recording.meanHr,
    window_beats: size,
    n_windows: windows.length,
    n_flagged: flagged.length,
    flagged_time_share: flagged.reduce((sum, each) => sum + seconds(each), 0) / total,
    windows,
    threshold: RESEARCH_THRESHOLD_LABEL,
    simulator_ground_truth: {
      profile: rhythmProfileOf(input.subject_ref).profile,
      af_interval_share: countOf(recording.labels, "af") / recording.labels.length,
      pac: countOf(recording.labels, "pac"),
      pvc: countOf(recording.labels, "pvc"),
      note: "simulator settings for this synthetic recording, for checking the metrics; not a finding about a person",
    },
  };
};

export const runRhythmIrregularity = (
  scope: SessionScope,
  input: RhythmIrregularityInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<RhythmIrregularityResult | ToolRefusal> =>
  audited<RhythmIrregularityResult | ToolRefusal>(
    scope,
    "rhythm_irregularity",
    input,
    scope.mode === "personal" ? null : input.subject_ref,
    async () => {
      if (scope.mode === "personal") return NO_RHYTHM_DATA;
      if (!(await subjectInScope(scope, input.subject_ref, ports))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      return describeRecording(input);
    },
    (result) => ("n" in result ? result.n : 0),
    ports,
  );

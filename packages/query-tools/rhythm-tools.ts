import "server-only";

import { simulateRecording } from "@/packages/rhythm-sim/simulate-recording";
import type { z } from "zod";

import {
  defaultQueryToolPorts,
  findConditionsInDatabase,
  findObservationSpanInDatabase,
  type QueryToolPorts,
} from "./ports";
import {
  NO_RHYTHM_DATA,
  outsideSubjectWindow,
  tooFewBeats,
  type ToolRefusal,
} from "./refusals";
import {
  AF_SNOMED_CODE,
  type RecordingPlan,
  recordingConfigFor,
} from "./rhythm-recording";
import { windowEndDate, windowStartDate, type rhythmIrregularityInput } from "./schemas";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import {
  beatWindows,
  IRREGULARITY_THRESHOLDS,
  type IrregularityWindow,
  irregularityWindow,
  utcDay,
} from "./stats";
import { audited, subjectInScope } from "./tool-core";

/**
 * `rhythm_irregularity` (#246): irregularity metrics of one simulated RR
 * recording of a synthetic subject, made by packages/rhythm-sim (see
 * rhythm-recording.ts for why it is made, not read). It describes the
 * recording; it never says a person has a condition. The simulator's ground
 * truth is not in the result: scorers call `rhythmGroundTruth` in code.
 */
export type RhythmIrregularityInput = z.infer<typeof rhythmIrregularityInput>;

/** A condition lookup reads at most this many rows; one is enough to know. */
const AF_CONDITION_TAKE = 1;

export const RESEARCH_THRESHOLD_LABEL =
  "research threshold after Dash et al. 2009 (Ann Biomed Eng 37:1701-1709): nRMSSD > 0.1 and turning-point ratio inside the 99.9 % band of random values, per 128 intervals; their Shannon entropy condition is reported but not applied (not validated here); a research threshold, not a diagnosis";

export type RhythmWindow = IrregularityWindow &
  Readonly<{ start_sec: number; end_sec: number }>;

export type RhythmIrregularityResult = Readonly<{
  subject_ref: string;
  recording: number;
  date: string;
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
}>;

/** The metrics of one planned recording. Pure; the tool wraps it in scope, reads and audit. */
export const describeRecording = (
  plan: RecordingPlan,
): RhythmIrregularityResult | ToolRefusal => {
  const recording = simulateRecording(recordingConfigFor(plan));
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
    subject_ref: plan.subjectRef,
    recording: plan.recording,
    date: plan.date,
    duration_sec: plan.durationSec,
    source: "simulated",
    n: recording.rrMs.length,
    mean_hr: recording.meanHr,
    window_beats: size,
    n_windows: windows.length,
    n_flagged: flagged.length,
    flagged_time_share: flagged.reduce((sum, each) => sum + seconds(each), 0) / total,
    windows,
    threshold: RESEARCH_THRESHOLD_LABEL,
  };
};

/**
 * Scope, then the subject's observation span (the recording day must lie in
 * it; default its last day), then whether an AF condition overlaps that day,
 * read with the same query as `conditions_timeline`.
 */
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
      const span = await (ports.findObservationSpan ?? findObservationSpanInDatabase)(
        input.subject_ref,
      );
      if (span === null) {
        return outsideSubjectWindow(input.date ?? null, { start: null, end: null });
      }
      const first = utcDay(span.first);
      const last = utcDay(span.last);
      const date = input.date ?? last;
      if (date < first || date > last) {
        return outsideSubjectWindow(date, { start: first, end: last });
      }
      const conditions = await (ports.findConditions ?? findConditionsInDatabase)({
        subjectRef: input.subject_ref,
        start: windowStartDate(date),
        end: windowEndDate(date),
        code: AF_SNOMED_CODE,
        take: AF_CONDITION_TAKE,
      });
      return describeRecording({
        subjectRef: input.subject_ref,
        recording: input.recording,
        durationSec: input.duration_sec,
        date,
        afConditionActive: conditions.length > 0,
      });
    },
    (result) => ("n" in result ? result.n : 0),
    ports,
  );

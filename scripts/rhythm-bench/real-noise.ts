/**
 * The benchmark's beat-detection noise applied to the database's annotated
 * beats (#296): the same `perturbBeats` levels as the simulated grid, then the
 * same windows, flag and statistics, so specificity under noise can be read
 * on real beats next to simulated ones. Pure and seeded per record.
 *
 * Each segment of a record (`labelledSegments`: intervals over 3 s split a
 * series) is perturbed on its own, with a generator seeded from the record
 * name, the level and the segment's position. The annotated beats are the
 * starting point, so level "none" gives exactly the database windows of
 * `recordWindows`. Annotated beats are not error free either; the noise is
 * added on top of whatever errors they have.
 */
import { hash32, randomFor } from "@/infrastructure/seeded-random";

import { type LabelledSegment, labelledSegments } from "./afdb-series";
import { type Summary, summarise } from "./analysis";
import { type AfdbRecordInput, AFDB_AF_LABEL, type RealWindowRow } from "./benchmark";
import { intervalsOf, type LabelledBeats, perturbBeatsCounted } from "./perturb";
import { type NoiseLevel } from "./sim-grid";
import { labelledWindows } from "./windows";

export type RealNoiseRow = RealWindowRow & Readonly<{ noise: string }>;

export type RealNoiseRecord = Readonly<{
  rows: readonly RealNoiseRow[];
  /** Annotated beats in the record's segments before perturbation. */
  beats: number;
  missed: number;
  spurious: number;
}>;

export type RealNoiseLevel = Readonly<{
  noise: string;
  /** Annotated beats in the segments of all records, before perturbation. */
  beats: number;
  missed: number;
  spurious: number;
  summary: Summary;
}>;

/** A stable seed per database record; the level and segment go in the generator key. */
export const realRecordSeed = (record: string): number =>
  hash32(`rhythm-bench-real:${record}`);

/** Beat times (ms from the record start) of a segment, labels unchanged. */
export const segmentBeats = (segment: LabelledSegment): LabelledBeats<string> => ({
  beatTimesMs: segment.rrMs.reduce<number[]>(
    (times, rr) => {
      times.push(times[times.length - 1] + rr);
      return times;
    },
    [segment.startSec * 1000],
  ),
  labels: segment.rhythms,
});

const isAf = (label: string): boolean => label === AFDB_AF_LABEL;

export const perturbedRecordWindows = (
  input: AfdbRecordInput,
  noise: NoiseLevel,
): RealNoiseRecord => {
  const seed = realRecordSeed(input.record);
  // Appended in place: copying the rows per segment is quadratic on 24 h records.
  const rows: RealNoiseRow[] = [];
  let beats = 0;
  let missed = 0;
  let spurious = 0;
  labelledSegments(input.beats, input.rhythmChanges, input.samplingHz).forEach(
    (segment, i) => {
      const original = segmentBeats(segment);
      const counted = perturbBeatsCounted(
        original,
        noise,
        randomFor(seed, `perturb:${noise.id}:${i}`),
      );
      const windows = labelledWindows(
        input.record,
        intervalsOf(counted.beats.beatTimesMs),
        counted.beats.labels,
        isAf,
        false,
        rows.length,
      );
      for (const row of windows)
        rows.push({ ...row, record: input.record, noise: noise.id });
      beats += original.beatTimesMs.length;
      missed += counted.missed;
      spurious += counted.spurious;
    },
  );
  return { rows, beats, missed, spurious };
};

/** Every record at every level, and one summary per level (records are the bootstrap clusters). */
export const realNoiseLevels = (
  records: readonly AfdbRecordInput[],
  levels: readonly NoiseLevel[],
  resamples: number,
  seed: number,
): { levels: RealNoiseLevel[]; rows: RealNoiseRow[] } => {
  const perLevel = levels.map((noise) => {
    const perRecord = records.map((record) => perturbedRecordWindows(record, noise));
    const rows = perRecord.flatMap((each) => each.rows);
    return {
      rows,
      level: {
        noise: noise.id,
        beats: perRecord.reduce((total, each) => total + each.beats, 0),
        missed: perRecord.reduce((total, each) => total + each.missed, 0),
        spurious: perRecord.reduce((total, each) => total + each.spurious, 0),
        summary: summarise(`real-noise=${noise.id}`, rows, resamples, seed),
      },
    };
  });
  return {
    levels: perLevel.map((each) => each.level),
    rows: perLevel.flatMap((each) => each.rows),
  };
};

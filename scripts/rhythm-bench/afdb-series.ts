/**
 * RR intervals of one annotated record, each labelled with the reference
 * rhythm in effect at the beat that ends it (the simulator labels the same
 * beat). Pure.
 *
 * Intervals before the first rhythm annotation have no label and are left
 * out. An interval longer than `MAX_RR_MS` is read as a gap (an unreadable
 * block or missed detections, not a heartbeat) and splits the series into
 * segments; windows never cross a segment boundary.
 */
import { type RhythmChange } from "./mit-annotations";

export const MAX_RR_MS = 3000;

export type LabelledSegment = Readonly<{
  /** Time of the first beat of the segment, s from the start of the record. */
  startSec: number;
  rrMs: readonly number[];
  /** Reference rhythm per interval ("AFIB", "N", "AFL", "J", ...). */
  rhythms: readonly string[];
}>;

/** The rhythm in effect at `sample`: the last change at or before it, or null. */
export const rhythmAt = (
  changes: readonly RhythmChange[],
  sample: number,
): string | null => {
  let found: string | null = null;
  for (const change of changes) {
    if (change.sample > sample) break;
    found = change.rhythm;
  }
  return found;
};

export const labelledSegments = (
  beats: readonly number[],
  changes: readonly RhythmChange[],
  samplingHz: number,
): LabelledSegment[] => {
  const sorted = [...changes].sort((a, b) => a.sample - b.sample);
  const segments: { startSec: number; rrMs: number[]; rhythms: string[] }[] = [];
  let open: { startSec: number; rrMs: number[]; rhythms: string[] } | null = null;
  let change = 0;
  let rhythm: string | null = null;
  for (let i = 1; i < beats.length; i += 1) {
    while (change < sorted.length && sorted[change].sample <= beats[i]) {
      rhythm = sorted[change].rhythm;
      change += 1;
    }
    const rr = Math.round(((beats[i] - beats[i - 1]) * 1000) / samplingHz);
    if (rhythm === null || rr > MAX_RR_MS || rr <= 0) {
      open = null;
      continue;
    }
    if (open === null) {
      open = { startSec: beats[i - 1] / samplingHz, rrMs: [], rhythms: [] };
      segments.push(open);
    }
    open.rrMs.push(rr);
    open.rhythms.push(rhythm);
  }
  return segments;
};

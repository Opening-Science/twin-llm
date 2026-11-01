/**
 * Database records as intervals for the resolution study (#290): each
 * labelled segment of `labelledSegments` is its own run, timed from the start
 * of the record, so hours follow the record's clock and no difference crosses
 * a gap. AF is the reference rhythm `(AFIB`. Pure.
 */
import { labelledSegments } from "../afdb-series";
import { AFDB_AF_LABEL, type AfdbRecordInput } from "../benchmark";
import { type Interval } from "./aggregate";

export const recordIntervals = (input: AfdbRecordInput): Interval[] => {
  const out: Interval[] = [];
  labelledSegments(input.beats, input.rhythmChanges, input.samplingHz).forEach(
    (segment, run) => {
      let endMs = segment.startSec * 1000;
      segment.rrMs.forEach((rrMs, i) => {
        endMs += rrMs;
        out.push({ endMs, rrMs, af: segment.rhythms[i] === AFDB_AF_LABEL, run });
      });
    },
  );
  return out;
};

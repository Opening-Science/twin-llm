import { describe, expect, test } from "bun:test";

import { recordIntervals } from "./real";

describe("recordIntervals", () => {
  test("each segment is a run timed from the record start; AFIB is AF", () => {
    // 250 Hz: 200 samples = 800 ms. The 1000-sample gap (4 s) splits the series.
    const intervals = recordIntervals({
      record: "r",
      beatAnnotator: "qrs",
      samplingHz: 250,
      hasSignalFile: false,
      beats: [0, 200, 400, 1400, 1600],
      rhythmChanges: [
        { sample: 0, rhythm: "N" },
        { sample: 300, rhythm: "AFIB" },
      ],
    });
    expect(intervals).toEqual([
      { endMs: 800, rrMs: 800, af: false, run: 0 },
      { endMs: 1600, rrMs: 800, af: true, run: 0 },
      { endMs: 6400, rrMs: 800, af: true, run: 1 },
    ]);
  });
});

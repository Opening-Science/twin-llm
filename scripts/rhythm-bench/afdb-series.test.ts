import { describe, expect, test } from "bun:test";

import { labelledSegments, MAX_RR_MS, rhythmAt } from "./afdb-series";

const CHANGES = [
  { sample: 100, rhythm: "N" },
  { sample: 1000, rhythm: "AFIB" },
];

describe("rhythmAt", () => {
  test("the last change at or before the sample", () => {
    expect(rhythmAt(CHANGES, 99)).toBe(null);
    expect(rhythmAt(CHANGES, 100)).toBe("N");
    expect(rhythmAt(CHANGES, 999)).toBe("N");
    expect(rhythmAt(CHANGES, 1000)).toBe("AFIB");
  });
});

describe("labelledSegments", () => {
  test("labels each interval by the rhythm at its ending beat, drops the unlabelled start", () => {
    // 250 Hz: 200 samples = 800 ms. Beat at 50 ends no labelled interval.
    const beats = [0, 50, 250, 450, 650, 850, 1050, 1200];
    expect(labelledSegments(beats, CHANGES, 250)).toEqual([
      {
        startSec: 0.2,
        rrMs: [800, 800, 800, 800, 800, 600],
        rhythms: ["N", "N", "N", "N", "AFIB", "AFIB"],
      },
    ]);
  });

  test("an interval over MAX_RR_MS splits the series", () => {
    const gap = ((MAX_RR_MS + 4) * 250) / 1000;
    const beats = [100, 300, 300 + gap, 500 + gap, 700 + gap];
    expect(labelledSegments(beats, [{ sample: 0, rhythm: "N" }], 250)).toEqual([
      { startSec: 0.4, rrMs: [800], rhythms: ["N"] },
      { startSec: (300 + gap) / 250, rrMs: [800, 800], rhythms: ["N", "N"] },
    ]);
  });

  test("unsorted rhythm changes are sorted first", () => {
    const changes = [CHANGES[1], CHANGES[0]];
    expect(labelledSegments([900, 1100], changes, 250)[0].rhythms).toEqual(["AFIB"]);
  });

  test("128 Hz (Long-Term AF Database): one sample is 7.8125 ms, rounded to whole ms", () => {
    expect(
      labelledSegments([0, 128, 256, 320, 417], [{ sample: 0, rhythm: "N" }], 128),
    ).toEqual([
      { startSec: 0, rrMs: [1000, 1000, 500, 758], rhythms: ["N", "N", "N", "N"] },
    ]);
  });
});

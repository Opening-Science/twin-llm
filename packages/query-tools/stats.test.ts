import { describe, expect, test } from "bun:test";

import {
  beatWindows,
  coverage,
  histogramEntropy,
  irregularityWindow,
  normalisedRmssd,
  populationSd,
  randomTurningPointRange,
  sampleEntropy,
  turningPoints,
  withoutExtremes,
  dayIndex,
  daysInWindow,
  longestGapDays,
  mad,
  maximum,
  mean,
  median,
  minimum,
  olsSlopePerDay,
  robustZ,
  type TimedValue,
} from "./stats";

const DAY0 = Date.parse("2024-01-01T08:00:00.000Z");
const HOUR = 3_600_000;

const onDays = (pairs: readonly (readonly [number, number])[]): TimedValue[] =>
  pairs.map(([day, value]) => ({ at: new Date(DAY0 + day * 24 * HOUR), value }));

describe("mean and median", () => {
  test("mean of 1..4 is 2.5; empty is null", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(mean([])).toBeNull();
  });

  test("odd count takes the middle, even count the mean of the two middles", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });

  test("empty median is null", () => {
    expect(median([])).toBeNull();
  });
});

describe("mad", () => {
  test("1, 2, 3, 4, 100: median 3, deviations 2 1 0 1 97, MAD 1", () => {
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
  });

  test("1..4: median 2.5, deviations 1.5 0.5 0.5 1.5, MAD 1", () => {
    expect(mad([1, 2, 3, 4])).toBe(1);
  });

  test("constant values give MAD 0", () => {
    expect(mad([5, 5, 5])).toBe(0);
  });

  test("empty is null", () => {
    expect(mad([])).toBeNull();
  });
});

describe("minimum and maximum", () => {
  test("of 3, -1, 2 are -1 and 3; empty is null", () => {
    expect(minimum([3, -1, 2])).toBe(-1);
    expect(maximum([3, -1, 2])).toBe(3);
    expect(minimum([])).toBeNull();
    expect(maximum([])).toBeNull();
  });
});

describe("robustZ", () => {
  test("baseline 10..18 (median 14, MAD 2), target 20: 6 / 2.9652 ≈ 2.0235", () => {
    expect(robustZ([10, 12, 14, 16, 18], [20])).toBe(6 / 2.9652);
  });

  test("target below the baseline is negative: target 11, 13 → -2 / 2.9652", () => {
    expect(robustZ([10, 12, 14, 16, 18], [11, 13])).toBe(-2 / 2.9652);
  });

  test("baseline MAD 0 is null", () => {
    expect(robustZ([5, 5, 5], [9])).toBeNull();
  });

  test("an empty baseline or target is null", () => {
    expect(robustZ([], [9])).toBeNull();
    expect(robustZ([10, 12, 14], [])).toBeNull();
  });
});

describe("olsSlopePerDay", () => {
  test("days 0/4/8 at 70/73/73: slope 12/32 = 0.375, fitted 70.5 and 73.5", () => {
    expect(
      olsSlopePerDay(
        onDays([
          [0, 70],
          [4, 73],
          [8, 73],
        ]),
      ),
    ).toEqual({ slopePerDay: 0.375, fittedFirst: 70.5, fittedLast: 73.5 });
  });

  test("order of the points does not matter", () => {
    expect(
      olsSlopePerDay(
        onDays([
          [8, 73],
          [0, 70],
          [4, 73],
        ]),
      ),
    ).toEqual({ slopePerDay: 0.375, fittedFirst: 70.5, fittedLast: 73.5 });
  });

  test("days 0/2/4/6 at 80/79/78/77: slope -0.5, fitted 80 and 77", () => {
    expect(
      olsSlopePerDay(
        onDays([
          [0, 80],
          [2, 79],
          [4, 78],
          [6, 77],
        ]),
      ),
    ).toEqual({ slopePerDay: -0.5, fittedFirst: 80, fittedLast: 77 });
  });

  test("exactly two days of span is enough: 1/2/3 on days 0/1/2 is slope 1", () => {
    expect(
      olsSlopePerDay(
        onDays([
          [0, 1],
          [1, 2],
          [2, 3],
        ]),
      ),
    ).toEqual({ slopePerDay: 1, fittedFirst: 1, fittedLast: 3 });
  });

  test("constant values give slope 0", () => {
    expect(
      olsSlopePerDay(
        onDays([
          [0, 5],
          [1, 5],
          [2, 5],
        ]),
      ),
    ).toEqual({ slopePerDay: 0, fittedFirst: 5, fittedLast: 5 });
  });

  test("n < 3 is null", () => {
    expect(
      olsSlopePerDay(
        onDays([
          [0, 70],
          [10, 80],
        ]),
      ),
    ).toBeNull();
    expect(olsSlopePerDay([])).toBeNull();
  });

  test("three points within 47 hours is null", () => {
    expect(
      olsSlopePerDay([
        { at: new Date(DAY0), value: 60 },
        { at: new Date(DAY0 + 12 * HOUR), value: 62 },
        { at: new Date(DAY0 + 47 * HOUR), value: 64 },
      ]),
    ).toBeNull();
  });
});

describe("dayIndex", () => {
  test("UTC midnight starts a new day", () => {
    expect(dayIndex(new Date("1970-01-02T00:00:00.000Z"))).toBe(1);
    expect(dayIndex(new Date("2024-01-01T23:59:59.999Z"))).toBe(19723);
    expect(dayIndex(new Date("2024-01-02T00:00:00.000Z"))).toBe(19724);
  });
});

describe("daysInWindow", () => {
  test("counts start's day through end's day", () => {
    expect(
      daysInWindow(
        new Date("2024-01-01T00:00:00.000Z"),
        new Date("2024-01-10T00:00:00.000Z"),
      ),
    ).toBe(10);
    expect(
      daysInWindow(
        new Date("2024-01-01T08:00:00.000Z"),
        new Date("2024-01-01T09:00:00.000Z"),
      ),
    ).toBe(1);
  });
});

describe("longestGapDays", () => {
  test("data on 2, 3, 7 in 0..9: gaps 2, 0, 3, 2 → 3", () => {
    expect(longestGapDays([2, 3, 7], 0, 9)).toBe(3);
  });

  test("leading gap counts: data on 5 in 0..9 → 5", () => {
    expect(longestGapDays([5], 0, 9)).toBe(5);
  });

  test("trailing gap counts: data on 0, 1 in 0..9 → 8", () => {
    expect(longestGapDays([0, 1], 0, 9)).toBe(8);
  });

  test("no data is the whole window", () => {
    expect(longestGapDays([], 0, 9)).toBe(10);
  });

  test("every day covered is 0", () => {
    expect(longestGapDays([0, 1, 2, 3, 4], 0, 4)).toBe(0);
  });

  test("duplicates and days outside the window are ignored", () => {
    expect(longestGapDays([2, 2, 15], 0, 9)).toBe(7);
  });
});

describe("coverage", () => {
  const start = new Date("2024-01-01T00:00:00.000Z");
  const end = new Date("2024-01-10T00:00:00.000Z");

  test("3 of 10 days, two rows on one day, longest gap 5 (days 6–10)", () => {
    expect(
      coverage(
        [
          new Date("2024-01-01T08:00:00.000Z"),
          new Date("2024-01-02T08:00:00.000Z"),
          new Date("2024-01-02T20:00:00.000Z"),
          new Date("2024-01-05T08:00:00.000Z"),
        ],
        start,
        end,
      ),
    ).toEqual({
      daysInWindow: 10,
      daysWithData: 3,
      coverageRatio: 0.3,
      longestGapDays: 5,
    });
  });

  test("no rows: ratio 0 and the gap is the whole window", () => {
    expect(coverage([], start, end)).toEqual({
      daysInWindow: 10,
      daysWithData: 0,
      coverageRatio: 0,
      longestGapDays: 10,
    });
  });

  test("a window from noon to the next-but-one morning touches 3 days", () => {
    expect(
      coverage(
        [new Date("2024-01-02T09:00:00.000Z")],
        new Date("2024-01-01T12:00:00.000Z"),
        new Date("2024-01-03T06:00:00.000Z"),
      ),
    ).toEqual({
      daysInWindow: 3,
      daysWithData: 1,
      coverageRatio: 1 / 3,
      longestGapDays: 1,
    });
  });
});

describe("RR-interval irregularity", () => {
  test("withoutExtremes drops the k smallest and largest, keeping order; ties by position", () => {
    expect(withoutExtremes([5, 1, 9, 3, 7], 1)).toEqual([5, 3, 7]);
    expect(withoutExtremes([2, 2, 2, 2], 1)).toEqual([2, 2]);
    expect(withoutExtremes([1, 2], 1)).toEqual([]);
  });

  test("normalisedRmssd: 1000, 1100, 1000 → RMSSD 100 / mean 1033.3 = 300 / 3100", () => {
    expect(normalisedRmssd([1000, 1100, 1000])).toBeCloseTo(300 / 3100, 12);
    expect(normalisedRmssd([1000])).toBeNull();
  });

  test("histogramEntropy: even spread 1, a 3:1 split, one value 0, none null", () => {
    expect(histogramEntropy([0, 1, 2, 3], 4)).toBeCloseTo(1, 12);
    expect(histogramEntropy([0, 0, 0, 3], 4)).toBeCloseTo(
      -(0.75 * Math.log(0.75) + 0.25 * Math.log(0.25)) / Math.log(4),
      12,
    );
    expect(histogramEntropy([5, 5])).toBe(0);
    expect(histogramEntropy([])).toBeNull();
  });

  test("populationSd of 2, 4, 4, 4, 5, 5, 7, 9 is 2", () => {
    expect(populationSd([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(populationSd([])).toBeNull();
  });

  test("sampleEntropy, m 2, r 0.5: 1 2 1 2 1 3 1 2 has B 2, A 1 → ln 2", () => {
    expect(sampleEntropy([1, 2, 1, 2, 1, 3, 1, 2], 2, 0.5)).toBeCloseTo(Math.log(2), 12);
  });

  test("sampleEntropy: a strict repeat is 0; no length-3 match is null; too short is null", () => {
    expect(sampleEntropy([1, 2, 1, 2, 1, 2], 2, 0.5)).toBe(0);
    expect(sampleEntropy([1, 2, 3, 1, 2, 4], 2, 0.5)).toBeNull();
    expect(sampleEntropy([1, 2, 3], 2, 0.5)).toBeNull();
  });

  test("turningPoints: 1 3 2 4 4 5 has two (a peak at 3, a trough at 2; flat 4 4 is neither)", () => {
    expect(turningPoints([1, 3, 2, 4, 4, 5])).toBe(2);
  });

  test("randomTurningPointRange(112): (220/3 ± 2·√(1763/90)) / 112", () => {
    const spread = 2 * Math.sqrt(1763 / 90);
    const range = randomTurningPointRange(112);
    expect(range.low).toBeCloseTo((220 / 3 - spread) / 112, 12);
    expect(range.high).toBeCloseTo((220 / 3 + spread) / 112, 12);
    expect(range.low).toBeCloseTo(0.5757, 4);
    expect(range.high).toBeCloseTo(0.7338, 4);
  });

  test("irregularityWindow of a flat window: all zero, not flagged", () => {
    expect(irregularityWindow(Array.from({ length: 128 }, () => 1000))).toEqual({
      n: 128,
      nrmssd: 0,
      shannon_entropy: 0,
      sample_entropy: 0,
      turning_point_ratio: 0,
      flagged: false,
    });
  });

  test("irregularityWindow of 1000/1200 alternating: two bins (entropy 0.25), not flagged", () => {
    const window = irregularityWindow(
      Array.from({ length: 128 }, (_, i) => (i % 2 === 0 ? 1000 : 1200)),
    );
    expect(window.shannon_entropy).toBeCloseTo(0.25, 12);
    expect(window.flagged).toBe(false);
  });

  test("beatWindows keeps whole windows only", () => {
    expect(beatWindows([1, 2, 3, 4, 5], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(beatWindows([1], 2)).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";

import { effectsTable, hourTable } from "./report";

describe("effectsTable", () => {
  test("measured change next to generator 3's assumption", () => {
    expect(
      effectsTable(
        [
          {
            noise: "none",
            burden: 0.3,
            days: 4,
            heartRateChange: 12.34,
            restingHeartRateChange: 1,
            hrvRmssdRatio: 1.5,
            afShare: 0.4,
          },
        ],
        "none",
      ).split("\n")[2],
    ).toBe("| AF 30 % | 4 | 0.400 | 12.3 | +10 to +20 | 1.0 | 0 | 1.50 | 1.60 |");
  });
});

describe("hourTable", () => {
  test("n/a for a missing cell, AUROC with its interval otherwise", () => {
    const lines = hourTable(
      [
        {
          source: "afdb",
          noise: "none",
          feature: "beat.flag_share",
          bin: "any",
          positives: 3,
          negatives: 4,
          clusters: 2,
          auroc: { value: 0.9, ci95: { low: 0.8, high: 1 } },
        },
      ],
      "afdb",
      "none",
    ).split("\n");
    expect(lines[2]).toBe(
      "| beat: Share of 128-beat windows flagged | n/a | n/a | n/a | n/a | 0.900 [0.800, 1.000] |",
    );
  });
});

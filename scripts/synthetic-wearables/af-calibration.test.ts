import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  AF_CALIBRATION,
  type AfDailyEffect,
  afDailyEffectAt,
  calibrationPoints,
} from "./af-calibration";
import { afDayEffects, type SubjectCondition } from "./conditions";
import { generateSeries } from "./series";

/** The committed study summary, read here on its own rather than through the module. */
const STUDY = JSON.parse(
  readFileSync(
    join(import.meta.dir, "../../docs/research/af-resolution-2026-10.summary.json"),
    "utf8",
  ),
) as {
  dailyEffects: Array<{
    noise: string;
    burden: number;
    heartRateChange: number;
    restingHeartRateChange: number;
    hrvRmssdRatio: number;
  }>;
};

const studyRow = (burden: number) => {
  const row = STUDY.dailyEffects.find((r) => r.noise === "none" && r.burden === burden);
  if (row === undefined) throw new Error(`no study row at ${burden}`);
  return row;
};

/** Stated tolerance: 0.05 /min for the heart rates, 0.005 for the RMSSD ratio. */
const HR_TOLERANCE = 0.05;
const RATIO_TOLERANCE = 0.005;

describe("v3.1 daily AF effects against the resolution study (#365)", () => {
  test.each([0.02, 0.1, 0.3, 0.6])(
    "burden %p matches the study's day aggregates",
    (burden) => {
      const study = studyRow(burden);
      const v3 = afDayEffects(burden);
      expect(
        Math.abs(v3.restingHrDelta + v3.heartRateDelta - study.heartRateChange),
      ).toBeLessThan(HR_TOLERANCE);
      expect(Math.abs(v3.restingHrDelta - study.restingHeartRateChange)).toBeLessThan(
        HR_TOLERANCE,
      );
      expect(Math.abs(v3.irregularHrvFactor - study.hrvRmssdRatio)).toBeLessThan(
        RATIO_TOLERANCE,
      );
    },
  );

  test("the series moves by those effects on AF days, and nothing else moves", () => {
    const options = { seed: 4242, endDay: "2026-10-01", days: 90 } as const;
    const af: readonly SubjectCondition[] = [
      { kind: "atrial_fibrillation", onset: "2026-08-20", abatement: null },
    ];
    let afDays = 0;
    for (let index = 0; index < 30; index += 1) {
      const subjectRef = `s${index}`;
      const without = generateSeries({ ...options, subjectRef });
      const withAf = generateSeries({ ...options, subjectRef, conditions: af });
      expect(withAf.length).toBe(without.length);
      const value = (series: typeof without, day: string, metric: string) =>
        series.find((r) => r.day === day && r.metric === metric)?.value ?? Number.NaN;
      const burdens = withAf.filter((r) => r.metric === "af_burden" && r.value > 0);
      for (const { day, value: burden } of burdens) {
        afDays += 1;
        const effect = afDayEffects(burden);
        const resting = value(without, day, "resting_heart_rate");
        // Away from the 45 and 90 /min clamps, each value moves by the effect,
        // give or take the rounding of both values.
        if (resting > 46 && resting < 89) {
          expect(
            Math.abs(
              value(withAf, day, "resting_heart_rate") - resting - effect.restingHrDelta,
            ),
          ).toBeLessThanOrEqual(1);
          expect(
            Math.abs(
              value(withAf, day, "heart_rate") -
                value(without, day, "heart_rate") -
                effect.restingHrDelta -
                effect.heartRateDelta,
            ),
          ).toBeLessThanOrEqual(1);
        }
        const hrv = value(without, day, "hrv_rmssd");
        expect(
          Math.abs(value(withAf, day, "hrv_rmssd") - hrv * effect.irregularHrvFactor),
        ).toBeLessThanOrEqual(1.5);
      }
      const unchanged = (r: { metric: string }) =>
        !["heart_rate", "resting_heart_rate", "hrv_rmssd"].includes(r.metric) &&
        !["af_burden", "irregular_rhythm_notifications"].includes(r.metric);
      expect(withAf.filter(unchanged)).toEqual(without.filter(unchanged));
    }
    expect(afDays).toBeGreaterThan(20);
  });
});

describe("calibrationPoints", () => {
  test("reads the clean-beat AF rows, sorted, without the sinus row", () => {
    expect(AF_CALIBRATION.map((point) => point.burden)).toEqual([0.02, 0.1, 0.3, 0.6]);
    expect(AF_CALIBRATION[3]?.heartRateChange).toBeCloseTo(20.94, 2);
    const light = calibrationPoints(STUDY, "light");
    expect(light[3]?.hrvRmssdRatio).toBeCloseTo(1.022, 3);
  });

  test("fails on a summary without usable rows", () => {
    expect(() => calibrationPoints({})).toThrow("no dailyEffects");
    expect(() => calibrationPoints({ dailyEffects: [] })).toThrow("fewer than two");
    expect(() =>
      calibrationPoints({
        dailyEffects: [
          {
            noise: "none",
            burden: 0.1,
            heartRateChange: 1,
            restingHeartRateChange: null,
          },
        ],
      }),
    ).toThrow("incomplete row");
  });
});

describe("afDailyEffectAt", () => {
  const points: readonly AfDailyEffect[] = [
    { burden: 0.2, heartRateChange: 4, restingHeartRateChange: 1, hrvRmssdRatio: 1.1 },
    { burden: 0.6, heartRateChange: 12, restingHeartRateChange: 3, hrvRmssdRatio: 1.3 },
  ];

  test("no effect at burden 0", () => {
    expect(afDailyEffectAt(0, points)).toEqual({
      burden: 0,
      heartRateChange: 0,
      restingHeartRateChange: 0,
      hrvRmssdRatio: 1,
    });
  });

  test("the points themselves, linear between them and from 0", () => {
    expect(afDailyEffectAt(0.6, points).heartRateChange).toBeCloseTo(12, 10);
    expect(afDailyEffectAt(0.4, points).heartRateChange).toBeCloseTo(8, 10);
    expect(afDailyEffectAt(0.4, points).hrvRmssdRatio).toBeCloseTo(1.2, 10);
    expect(afDailyEffectAt(0.1, points).restingHeartRateChange).toBeCloseTo(0.5, 10);
  });

  test("above the last point, along the last segment", () => {
    const effect = afDailyEffectAt(0.8, points);
    expect(effect.heartRateChange).toBeCloseTo(16, 10);
    expect(effect.restingHeartRateChange).toBeCloseTo(4, 10);
    expect(effect.hrvRmssdRatio).toBeCloseTo(1.4, 10);
  });
});

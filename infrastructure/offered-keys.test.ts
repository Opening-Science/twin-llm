import { describe, expect, test } from "bun:test";

import { matchOfferedMetric } from "./offered-keys";
import { parseTwinAnswer, resolveAttribution } from "./parse-twin-answer";

const metric = (key: string, label = key) => ({ key, label, value: 1 });

const SLEEP_HR = metric("sleep.heart_rate.2026-01-01", "Average sleeping heart rate");
const SLEEP_HRV = metric("sleep.hrv.2026-01-01", "Sleep HRV");
const OFFERED = [SLEEP_HR, SLEEP_HRV] as const;

describe("matchOfferedMetric", () => {
  test("exact, then case-insensitive exact", () => {
    expect(matchOfferedMetric("sleep.hrv.2026-01-01", OFFERED)).toBe(SLEEP_HRV);
    expect(matchOfferedMetric("Sleep.HRV.2026-01-01", OFFERED)).toBe(SLEEP_HRV);
  });

  test("dotted prefix in both directions, on whole segments", () => {
    expect(matchOfferedMetric("sleep.hrv", OFFERED)).toBe(SLEEP_HRV);
    expect(matchOfferedMetric("sleep.hrv.2026-01-01.night", OFFERED)).toBe(SLEEP_HRV);
    expect(matchOfferedMetric("sleep.hr", OFFERED)).toBeNull();
  });

  test("prefix is at most one segment apart, in both directions", () => {
    const score = metric("oura.sleep.score.2026-01-01");
    expect(matchOfferedMetric("oura.sleep.score", [score])).toBe(score);
    expect(matchOfferedMetric("oura.sleep", [score])).toBeNull();
    const short = metric("oura.sleep.score");
    expect(matchOfferedMetric("oura.sleep.score.2026-01-01", [short])).toBe(short);
    expect(matchOfferedMetric("oura.sleep.score.2026-01-01.night", [short])).toBeNull();
  });

  test("no substring and no single-segment prefix", () => {
    expect(matchOfferedMetric("hr", OFFERED)).toBeNull();
    expect(matchOfferedMetric("heart_rate", OFFERED)).toBeNull();
    expect(matchOfferedMetric("sleep", OFFERED)).toBeNull();
  });
});

describe("resolveAttribution", () => {
  test("`hr` no longer attaches to sleep.heart_rate.*", () => {
    expect(resolveAttribution(["hr"], OFFERED, "- [hr]")).toEqual([]);
  });

  test("a dotted prefix still attaches to the offered metric", () => {
    expect(resolveAttribution(["sleep.hrv"], OFFERED, "- [sleep.hrv]")).toEqual([
      {
        metricKey: "sleep.hrv.2026-01-01",
        label: "Sleep HRV",
        value: 1,
        unit: undefined,
      },
    ]);
  });

  test("a key outside the offered list attaches to nothing", () => {
    expect(resolveAttribution(["oura.synthetic.m41.2026-01-01"], OFFERED, null)).toEqual(
      [],
    );
  });

  test("a cited value carries the source it was offered from and its day (#464)", () => {
    const window = { startDate: "2026-01-01", endDate: "2026-01-02" };
    const parsed = parseTwinAnswer(
      [
        "## Evidence Used",
        "- [sleep.hrv.2026-01-01]",
        "- [whoop.recovery.hrv.2026-01-02]",
        "- [personal.age]",
      ].join("\n"),
      {
        oura: {
          window,
          narrative: "",
          metrics: [SLEEP_HRV, { key: "personal.age", label: "Age", value: 40 }],
        },
        whoop: {
          window,
          narrative: "",
          metrics: [
            {
              key: "whoop.recovery.hrv.2026-01-02",
              label: "Recovery HRV",
              value: 48,
              unit: "ms",
            },
          ],
        },
        googleHealth: null,
        vitronic: null,
      },
    );
    expect(parsed.attribution).toEqual([
      {
        metricKey: "sleep.hrv.2026-01-01",
        label: "Sleep HRV",
        value: 1,
        unit: undefined,
        source: "oura",
        day: "2026-01-01",
      },
      {
        metricKey: "whoop.recovery.hrv.2026-01-02",
        label: "Recovery HRV",
        value: 48,
        unit: "ms",
        source: "whoop",
        day: "2026-01-02",
      },
      { metricKey: "personal.age", label: "Age", value: 40, source: "oura" },
    ]);
    expect(parsed.attribution[2]).not.toHaveProperty("day");
  });

  test("label fallback runs over offered metrics when no key matched", () => {
    expect(
      resolveAttribution([], OFFERED, "- Average sleeping heart rate was steady"),
    ).toEqual([
      {
        metricKey: "sleep.heart_rate.2026-01-01",
        label: "Average sleeping heart rate",
        value: 1,
        unit: undefined,
      },
    ]);
  });
});

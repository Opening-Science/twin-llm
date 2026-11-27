import { expect, test } from "bun:test";

import { observationCharts, type DayObservation } from "../charts/your-day-observations";
import {
  defaultVitalSeries,
  glucoseParticleDensity,
  vitalReadingAt,
  vitalSeriesForChart,
} from "./your-day-vitals";

const day = "2026-10-27";
const scope = {
  day,
  time_zone: "UTC",
  subject_ref: "personal",
  origin: "recorded",
} as const;
const point: DayObservation = {
  id: "reading",
  code: "8867-4",
  codeSystem: "http://loinc.org",
  sourceId: "import:apple",
  source: "Imported record",
  provenance: "imported",
  label: "Heart rate",
  unit: "/h",
  day,
  at: `${day}T08:00:00Z`,
  value: 4500,
  timing: "observation",
  interval_min: 0,
};
const seriesFor = (rows: readonly DayObservation[]) =>
  observationCharts(rows, []).flatMap((chart) => vitalSeriesForChart(chart, scope) ?? []);

test("personal chart and viewer can share normalized readings without using future or stale data", () => {
  const [series] = seriesFor([
    point,
    { ...point, id: "later", at: `${day}T09:00:00Z`, value: 5400 },
    { ...point, id: "different-day", day: "2026-10-28", at: "2026-10-28T08:00:00Z" },
  ]);
  const at = (time: string) => vitalReadingAt(series, Date.parse(`${day}T${time}Z`));
  expect(at("07:59:59")).toMatchObject({ state: "unavailable", why: "not_yet" });
  expect(at("08:00:00")).toMatchObject({ state: "available", reading: { value: 75 } });
  expect(at("08:30:01")).toMatchObject({ state: "stale" });
  expect(at("09:00:00")).toMatchObject({ state: "available", reading: { value: 90 } });
  expect(series?.readings).toHaveLength(2);
});

test("default glucose source prefers sensor without substituting blood during a gap", () => {
  const options = seriesFor([
    { ...point, id: "blood", code: "2345-7", unit: "g/L", value: 1.2 },
    {
      ...point,
      id: "sensor",
      code: "99504-3",
      unit: "mg/dL",
      value: 110,
      at: `${day}T09:00:00Z`,
    },
  ]);
  const selected = defaultVitalSeries(options, "glucose");
  expect(selected?.metric).toBe("sensor");
  expect(vitalReadingAt(selected, Date.parse(point.at))).toMatchObject({
    why: "not_yet",
  });
  expect(vitalReadingAt(options[0], Date.parse(point.at))).toMatchObject({
    state: "available",
    reading: { value: 120, specimen: "blood" },
  });
  expect(glucoseParticleDensity(100)).toBeLessThan(glucoseParticleDensity(200));
  expect(glucoseParticleDensity(1000)).toBe(1);
  expect(glucoseParticleDensity(null)).toBe(0);
});

test("daily averages, resting heart rate, and unrecognized units never drive effects", () => {
  expect(
    seriesFor([
      { ...point, timing: "day" },
      { ...point, code: "40443-4" },
      { ...point, unit: "Hz" },
    ]),
  ).toEqual([]);
});

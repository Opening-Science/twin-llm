import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { strToU8, zipSync } from "fflate";

import { detectWearableLayout, parseWearableExport } from "./parse-wearable-export";
import type { ObservationDraft, ParsedImport } from "./types";
import { fitbitDay } from "./wearable-fitbit";
import { unmappedCount } from "./types";
import {
  csvHeader,
  dayTime,
  hasColumns,
  isRecord,
  numberField,
  readCsv,
  readJson,
} from "./wearable-files";
import { createUnmappedTally } from "./wearable-measures";
import { whoopTime } from "./wearable-whoop";

const DIR = join(import.meta.dir, "../../tests/fixtures/personal-import/wearables");
const WHOOP = "my_whoop_data";
const FITBIT = "Takeout/Fitbit/Global Export Data";

const fixture = (path: string): Uint8Array =>
  new Uint8Array(readFileSync(join(DIR, path)));

const rows = (observations: readonly ObservationDraft[]) =>
  observations.map((row) => [
    row.code,
    row.display,
    row.value,
    row.unit,
    row.effectiveAt.toISOString(),
    row.effectivePrecision,
    row.sourceRef,
    row.note,
  ]);

const parsedRows = (parsed: ParsedImport) =>
  parsed.ok && parsed.kind === "wearable" ? rows(parsed.observations) : parsed;

const parse = (path: string) => {
  const parsed = parseWearableExport(path.split("/").pop()!, fixture(path));
  if (!parsed.ok || parsed.kind !== "wearable") throw new Error("expected rows");
  return parsed;
};

const unmapped = (parsed: ReturnType<typeof parse>) =>
  parsed.unmapped.map((row) => [row.where, row.code, row.count]);

describe("helpers", () => {
  test("whoopTime reads the local time with the cycle time zone", () => {
    const time = whoopTime("2026-09-01 23:10:00", "UTC+02:00");
    expect(time === null ? null : [time.time.at.toISOString(), time.localDay]).toEqual([
      "2026-09-01T21:10:00.000Z",
      "2026-09-01",
    ]);
    expect(whoopTime("2026-09-01 23:10:00", "")).toBe(null);
    expect(whoopTime("", "UTC+02:00")).toBe(null);
  });

  test("fitbitDay reads MM/DD/YY as a day", () => {
    const day = fitbitDay("09/01/26");
    expect(day === null ? null : [day.at.toISOString(), day.precision]).toEqual([
      "2026-09-01T00:00:00.000Z",
      "day",
    ]);
    expect(fitbitDay("09/01/26 07:00:00")?.at.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(fitbitDay("13/40/26")).toBe(null);
    expect(fitbitDay(20260901)).toBe(null);
  });

  test("csvHeader and readCsv", () => {
    expect(csvHeader('﻿"date", Steps\n1,2')).toEqual(["date", "Steps"]);
    expect(readCsv("a,b\n1\n3,4\n")).toEqual({
      header: ["a", "b"],
      rows: [
        { a: "1", b: "" },
        { a: "3", b: "4" },
      ],
    });
    expect(readCsv("")).toBe(null);
  });

  test("dayTime, hasColumns, readJson, isRecord and unmappedCount", () => {
    expect(dayTime("2026-09-01")?.at.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect([dayTime("2026-02-30"), dayTime("2026-09"), dayTime(20260901)]).toEqual([
      null,
      null,
      null,
    ]);
    expect(hasColumns("date,Steps\n", ["Steps", "date"])).toBe(true);
    expect(hasColumns("date,Steps\n", ["Nap"])).toBe(false);
    expect(readJson('{"a":1}')).toEqual({ a: 1 });
    expect(readJson("{broken")).toBe(undefined);
    expect([isRecord({}), isRecord([]), isRecord(null)]).toEqual([true, false, false]);
    expect(
      unmappedCount([
        { where: "a", code: "x", reason: "r" },
        { where: "b", code: "x", reason: "r", count: 4 },
      ]),
    ).toBe(5);
  });

  test("numberField reports missing and unreadable values, never zero", () => {
    const tally = createUnmappedTally();
    expect(numberField("54", "w", tally)).toBe(54);
    expect(numberField(48.5, "w", tally)).toBe(48.5);
    expect(numberField("", "w", tally)).toBe(null);
    expect(numberField(null, "w", tally)).toBe(null);
    expect(numberField("n/a", "w", tally)).toBe(null);
    expect(tally.list()).toEqual([
      { where: "w", code: "empty", reason: "is empty", count: 2 },
      {
        where: "w",
        code: "not-a-number",
        reason: "has a value that is not a plain number",
        count: 1,
      },
    ]);
  });
});

describe("detectWearableLayout", () => {
  test("knows each file by its name and header", () => {
    const layout = (path: string) =>
      detectWearableLayout(path, new TextDecoder().decode(fixture(path)))?.id ?? null;
    expect(
      [
        `${WHOOP}/physiological_cycles.csv`,
        `${WHOOP}/sleeps.csv`,
        `${WHOOP}/workouts.csv`,
        `${WHOOP}/journal_entries.csv`,
        "oura-data-export.json",
        "oura-trends.csv",
        `${FITBIT}/resting_heart_rate-2026-09-01.json`,
        `${FITBIT}/sleep-2026-09-01.json`,
        `${FITBIT}/weight-2026-09-01.json`,
        `${FITBIT}/steps-2026-09-01.json`,
        `${FITBIT}/calories-2026-09-01.json`,
      ].map(layout),
    ).toEqual([
      "whoop-cycles",
      "whoop-sleeps",
      "whoop-workouts",
      null,
      "oura-json",
      "oura-trends-csv",
      "fitbit-resting-heart-rate",
      "fitbit-sleep",
      "fitbit-weight",
      "fitbit-samples",
      null,
    ]);
  });
});

describe("Whoop", () => {
  test("physiological cycles: resting HR, HRV (RMSSD, no code) and SpO2", () => {
    const parsed = parse(`${WHOOP}/physiological_cycles.csv`);
    const at = "2026-09-01T21:10:00.000Z";
    const ref = "physiological_cycles.csv row 2";
    expect(rows(parsed.observations)).toEqual([
      ["40443-4", "Resting heart rate", 54, "/min", at, "instant", ref, null],
      [null, "Heart rate variability (RMSSD)", 48.5, "ms", at, "instant", ref, null],
      [
        "59408-5",
        "Oxygen saturation (pulse oximetry)",
        96.5,
        "%",
        at,
        "instant",
        ref,
        null,
      ],
    ]);
    expect(unmapped(parsed)).toEqual([
      ["physiological_cycles.csv: Resting heart rate (bpm)", "empty", 1],
      ["physiological_cycles.csv: Heart rate variability (ms)", "empty", 1],
      ["physiological_cycles.csv: Blood oxygen %", "empty", 1],
      ["physiological_cycles.csv", "no-time-zone", 1],
    ]);
    expect(parsed.notes).toEqual([
      "Read physiological_cycles.csv as Whoop physiological cycles.",
      "HRV from Oura and Whoop is RMSSD, which has no code here, so it is stored by name.",
    ]);
  });

  test("sleeps: minutes asleep on the wake day, naps reported", () => {
    const parsed = parse(`${WHOOP}/sleeps.csv`);
    expect(rows(parsed.observations)).toEqual([
      [
        "93832-4",
        "Sleep duration",
        421,
        "min",
        "2026-09-02T00:00:00.000Z",
        "day",
        "sleeps.csv row 2",
        null,
      ],
      [
        "9279-1",
        "Respiratory rate",
        14.6,
        "/min",
        "2026-09-01T21:10:00.000Z",
        "instant",
        "sleeps.csv row 2",
        null,
      ],
    ]);
    expect(unmapped(parsed)).toEqual([["sleeps.csv", "nap", 1]]);
  });

  test("workouts: duration and average heart rate by name, activity as the note", () => {
    const parsed = parse(`${WHOOP}/workouts.csv`);
    const at = "2026-09-02T16:00:00.000Z";
    expect(rows(parsed.observations)).toEqual([
      [
        null,
        "Workout duration",
        40,
        "min",
        at,
        "instant",
        "workouts.csv row 2",
        "Running",
      ],
      [
        null,
        "Average heart rate during a workout",
        148,
        "/min",
        at,
        "instant",
        "workouts.csv row 2",
        "Running",
      ],
    ]);
  });
});

describe("Oura", () => {
  test("JSON export: main sleep per day, steps and SpO2", () => {
    const parsed = parse("oura-data-export.json");
    const day2 = "2026-09-02T00:00:00.000Z";
    const day3 = "2026-09-03T00:00:00.000Z";
    const sleep2 = "oura-data-export.json sleep 2026-09-02";
    const sleep3 = "oura-data-export.json sleep 2026-09-03";
    expect(rows(parsed.observations)).toEqual([
      ["93832-4", "Sleep duration", 421, "min", day2, "day", sleep2, null],
      [null, "Lowest heart rate during sleep", 49, "/min", day2, "day", sleep2, null],
      [null, "Heart rate variability (RMSSD)", 52, "ms", day2, "day", sleep2, null],
      ["9279-1", "Respiratory rate", 14.25, "/min", day2, "day", sleep2, null],
      ["93832-4", "Sleep duration", 390, "min", day3, "day", sleep3, null],
      [null, "Heart rate variability (RMSSD)", 47, "ms", day3, "day", sleep3, null],
      ["9279-1", "Respiratory rate", 14.5, "/min", day3, "day", sleep3, null],
      [
        "41950-7",
        "Steps in 24 hours",
        8421,
        "{steps}/d",
        day2,
        "day",
        "oura-data-export.json daily_activity 2026-09-02",
        null,
      ],
      [
        "59408-5",
        "Oxygen saturation (pulse oximetry)",
        96.8,
        "%",
        day2,
        "day",
        "oura-data-export.json daily_spo2 2026-09-02",
        null,
      ],
    ]);
    expect(unmapped(parsed)).toEqual([
      ["oura-data-export.json: sleep", "not-main-sleep", 1],
      ["oura-data-export.json: sleep.lowest_heart_rate", "empty", 1],
      ["oura-data-export.json: daily_spo2.spo2_percentage.average", "empty", 1],
    ]);
  });

  test("trends CSV: the same values from the columns it knows", () => {
    const parsed = parse("oura-trends.csv");
    expect(parsed.observations.map((row) => [row.display, row.value])).toEqual([
      ["Sleep duration", 421],
      ["Lowest heart rate during sleep", 49],
      ["Heart rate variability (RMSSD)", 52],
      ["Respiratory rate", 14.25],
      ["Steps in 24 hours", 8421],
      ["Sleep duration", 390],
      ["Heart rate variability (RMSSD)", 47],
      ["Respiratory rate", 14.5],
    ]);
    expect(unmapped(parsed)).toEqual([
      ["oura-trends.csv: Lowest Resting Heart Rate", "empty", 1],
      ["oura-trends.csv: Steps", "empty", 1],
    ]);
  });
});

describe("Fitbit from Google Takeout", () => {
  test("resting heart rate: a 0 is no reading", () => {
    const parsed = parse(`${FITBIT}/resting_heart_rate-2026-09-01.json`);
    expect(rows(parsed.observations)).toEqual([
      [
        "40443-4",
        "Resting heart rate",
        58.3,
        "/min",
        "2026-09-01T00:00:00.000Z",
        "day",
        "resting_heart_rate-2026-09-01.json entry 1",
        null,
      ],
    ]);
    expect(unmapped(parsed)).toEqual([
      ["resting_heart_rate-2026-09-01.json", "zero-means-none", 1],
    ]);
  });

  test("sleep: main sleep on dateOfSleep; weight: BMI only", () => {
    expect(
      parse(`${FITBIT}/sleep-2026-09-01.json`).observations.map((row) => [
        row.code,
        row.value,
        row.effectiveAt.toISOString(),
      ]),
    ).toEqual([["93832-4", 402, "2026-09-02T00:00:00.000Z"]]);
    const weight = parse(`${FITBIT}/weight-2026-09-01.json`);
    expect(weight.observations.map((row) => [row.code, row.value, row.unit])).toEqual([
      ["39156-5", 22.91, "kg/m2"],
    ]);
    expect(unmapped(weight)).toEqual([["weight-2026-09-01.json", "unit-not-stated", 1]]);
  });

  test("per-sample steps without a time zone are reported, not summed", () => {
    const parsed = parse(`${FITBIT}/steps-2026-09-01.json`);
    expect(parsed.observations).toEqual([]);
    expect(unmapped(parsed)).toEqual([["steps-2026-09-01.json", "no-time-zone", 1]]);
  });
});

describe("parseWearableExport", () => {
  test("a zip: every known file read, unknown files listed as unsupported", () => {
    const zipped = zipSync({
      [`${WHOOP}/sleeps.csv`]: fixture(`${WHOOP}/sleeps.csv`),
      [`${WHOOP}/journal_entries.csv`]: fixture(`${WHOOP}/journal_entries.csv`),
      [`${FITBIT}/weight-2026-09-01.json`]: fixture(`${FITBIT}/weight-2026-09-01.json`),
      [`${FITBIT}/calories-2026-09-01.json`]: fixture(
        `${FITBIT}/calories-2026-09-01.json`,
      ),
      "__MACOSX/._sleeps.csv": strToU8("made-up metadata"),
      "photo.bin": new Uint8Array([0xff, 0xfe, 0x00]),
    });
    const parsed = parseWearableExport("export.zip", zipped);
    if (!parsed.ok || parsed.kind !== "wearable") throw new Error("expected rows");
    expect(parsed.observations.map((row) => [row.code, row.value])).toEqual([
      ["93832-4", 421],
      ["9279-1", 14.6],
      ["39156-5", 22.91],
    ]);
    expect(unmapped(parsed)).toEqual([
      ["sleeps.csv", "nap", 1],
      [`${WHOOP}/journal_entries.csv`, "unsupported-file", 1],
      ["weight-2026-09-01.json", "unit-not-stated", 1],
      [`${FITBIT}/calories-2026-09-01.json`, "unsupported-file", 1],
      ["photo.bin", "unreadable", 1],
    ]);
    expect(parsed.notes).toEqual([
      `Read ${WHOOP}/sleeps.csv as Whoop sleeps.`,
      `Read ${FITBIT}/weight-2026-09-01.json as Fitbit weight log (Google Takeout).`,
      "Sleep is minutes asleep of the main sleep of each night, on the day you woke up; naps are not stored.",
    ]);
  });

  test("an unknown file is listed, with nothing to store", () => {
    expect(parseWearableExport("notes.csv", strToU8("a,b\n1,2\n"))).toEqual({
      ok: true,
      kind: "wearable",
      observations: [],
      unmapped: [
        {
          where: "notes.csv",
          code: "unsupported-file",
          reason: "is not a file this import knows",
          count: 1,
        },
      ],
      notes: ["No file in this upload is one this import knows."],
    });
  });

  test("a broken zip is refused", () => {
    const zipped = zipSync({ "sleeps.csv": fixture(`${WHOOP}/sleeps.csv`) });
    expect(parsedRows(parseWearableExport("x.zip", zipped.subarray(0, 40)))).toEqual({
      ok: false,
      refusal: { code: "zip-unreadable", message: "The zip file could not be read." },
    });
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { strToU8, zipSync } from "fflate";

import { parseAppleDate, parseAppleHealth } from "./parse-apple-health";
import type { ObservationDraft } from "./types";

const FIXTURE = readFileSync(
  join(import.meta.dir, "../../tests/fixtures/personal-import/apple-health-export.xml"),
);

const rows = (observations: readonly ObservationDraft[]) =>
  observations.map((row) => [
    row.code,
    row.value,
    row.unit,
    row.effectiveAt.toISOString(),
    row.effectivePrecision,
    row.sourceRef,
  ]);

describe("parseAppleDate", () => {
  test("reads Apple's date with its offset and keeps the local day", () => {
    const date = parseAppleDate("2026-09-02 00:30:00 +0200");
    expect(date === null ? null : [date.time.at.toISOString(), date.localDay]).toEqual([
      "2026-09-01T22:30:00.000Z",
      "2026-09-02",
    ]);
    expect(parseAppleDate("2026-09-02 00:30:00")).toBe(null);
    expect(parseAppleDate("2026-02-30 00:30:00 +0000")).toBe(null);
    expect(parseAppleDate(undefined)).toBe(null);
  });
});

describe("parseAppleHealth", () => {
  const parsed = parseAppleHealth(FIXTURE);
  if (!parsed.ok || parsed.kind !== "apple-health") throw new Error("expected rows");

  test("stores the allowlisted samples in their UCUM unit", () => {
    expect(rows(parsed.observations)).toEqual([
      [
        "8867-4",
        64,
        "/min",
        "2026-09-01T06:00:05.000Z",
        "instant",
        "export.xml record 1",
      ],
      [
        "8867-4",
        71.5,
        "/min",
        "2026-09-01T10:30:00.000Z",
        "instant",
        "export.xml record 2",
      ],
      [
        "40443-4",
        55,
        "/min",
        "2026-08-31T22:00:00.000Z",
        "instant",
        "export.xml record 3",
      ],
      [
        "80404-7",
        42.3,
        "ms",
        "2026-09-01T04:10:00.000Z",
        "instant",
        "export.xml record 4",
      ],
      [
        "55423-8",
        812,
        "{steps}",
        "2026-09-01T07:00:00.000Z",
        "instant",
        "export.xml record 5",
      ],
      [
        "29463-7",
        70.4,
        "kg",
        "2026-09-01T05:00:00.000Z",
        "instant",
        "export.xml record 6",
      ],
      [
        "39156-5",
        22.9,
        "kg/m2",
        "2026-09-01T05:00:00.000Z",
        "instant",
        "export.xml record 8",
      ],
      ["59408-5", 97, "%", "2026-09-01T01:00:00.000Z", "instant", "export.xml record 9"],
      [
        "9279-1",
        14.5,
        "/min",
        "2026-09-01T01:30:00.000Z",
        "instant",
        "export.xml record 11",
      ],
      // 23:00-03:00 and 03:20-06:45 asleep, the phone's overlap counted once.
      [
        "93832-4",
        445,
        "min",
        "2026-09-02T00:00:00.000Z",
        "day",
        "export.xml sleep 2026-09-02",
      ],
    ]);
  });

  test("never stores device names or the Me element", () => {
    expect(parsed.observations.filter((row) => row.note !== null)).toEqual([]);
    expect(JSON.stringify(parsed)).not.toContain("Demo Watch");
    expect(JSON.stringify(parsed)).not.toContain("1990-01-01");
  });

  test("lists what it skipped with a reason and a count", () => {
    expect(parsed.unmapped).toEqual([
      {
        where: "HKQuantityTypeIdentifierBodyMass",
        code: "unit-not-converted",
        reason: "is in lb; only kg or g is read for this type",
        count: 1,
      },
      {
        where: "HKQuantityTypeIdentifierOxygenSaturation",
        code: "not-a-fraction",
        reason: "is not a fraction between 0 and 1 as Apple Health writes it",
        count: 1,
      },
      {
        where: "HKQuantityTypeIdentifierRespiratoryRate",
        code: "not-a-number",
        reason: "has a value that is not a plain number",
        count: 1,
      },
      {
        where: "HKQuantityTypeIdentifierActiveEnergyBurned",
        code: "unsupported-type",
        reason: "is a type this import does not read",
        count: 2,
      },
      {
        where: "HKCategoryTypeIdentifierSleepAnalysis",
        code: "not-asleep",
        reason: "is time in bed or awake, which is not counted as sleep",
        count: 2,
      },
      {
        where: "Correlation",
        code: "unsupported-element",
        reason: "is not read in this version",
        count: 1,
      },
      {
        where: "HKQuantityTypeIdentifierBloodPressureSystolic",
        code: "unsupported-type",
        reason: "is a type this import does not read",
        count: 1,
      },
      {
        where: "Workout",
        code: "unsupported-element",
        reason: "is not read in this version",
        count: 1,
      },
      {
        where: "ActivitySummary",
        code: "unsupported-element",
        reason: "is not read in this version",
        count: 1,
      },
    ]);
  });

  test("reads export.xml from the export zip and names the other files", () => {
    const zipped = zipSync({
      "apple_health_export/export.xml": new Uint8Array(FIXTURE),
      "apple_health_export/export_cda.xml": strToU8("<ClinicalDocument/>"),
      "apple_health_export/workout-routes/route_1.gpx": strToU8("<gpx/>"),
    });
    const fromZip = parseAppleHealth(zipped);
    expect(
      fromZip.ok && fromZip.kind === "apple-health" ? rows(fromZip.observations) : null,
    ).toEqual(rows(parsed.observations));
    expect(fromZip.ok ? fromZip.notes.at(-1) : null).toBe(
      "Only export.xml is read; the other 2 files in the zip (clinical documents, routes, ECGs) are not.",
    );
  });

  test("refuses what is not an export", () => {
    expect(parseAppleHealth(strToU8("<Other><Record type='x'/></Other>"))).toEqual({
      ok: false,
      refusal: {
        code: "not-apple-health",
        message: "This is not an Apple Health export.xml.",
      },
    });
    expect(parseAppleHealth(zipSync({ "notes.txt": strToU8("made up") }))).toEqual({
      ok: false,
      refusal: {
        code: "no-export-xml",
        message:
          "The zip has no export.xml. Choose the export.zip from Apple Health, or the export.xml inside it.",
      },
    });
    expect(parseAppleHealth(strToU8('<HealthData><Record type="'))).toEqual({
      ok: false,
      refusal: {
        code: "xml-incomplete",
        message: "The export.xml ends in the middle of a tag.",
      },
    });
    expect(parseAppleHealth(new Uint8Array([0x3c, 0xff, 0x3e]))).toEqual({
      ok: false,
      refusal: { code: "not-utf8", message: "The file is not UTF-8 text." },
    });
  });
});

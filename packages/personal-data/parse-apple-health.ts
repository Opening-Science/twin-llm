import { shiftDecimal } from "./decimal-text";
import { type EffectiveTime, parseEffectiveTime } from "./effective-time";
import { MAX_ROWS } from "./limits";
import { type SleepInterval, sleepNights } from "./sleep-nights";
import type { ObservationDraft, ParsedImport } from "./types";
import {
  createUnmappedTally,
  type Measure,
  MEASURES,
  measureObservation,
} from "./wearable-measures";
import { createXmlElementScanner, type XmlElement } from "./xml-elements";
import { baseName, isZip, readZipEntries, streamZipEntry } from "./zip-entries";

/**
 * An Apple Health export: the `export.zip` the Health app writes, or the
 * `export.xml` inside it. The XML is read as a stream of `Record` tags, so
 * a file far larger than memory comfortably holds is never decoded whole.
 *
 * Only an allowlist of quantity types is stored, each in one UCUM unit. A
 * unit is converted only by a power of ten (s to ms, g to kg, Apple's
 * fraction to %), on the digits, so the stored number is exact; any other
 * unit is reported with its name, never converted by a rounded factor.
 * Sleep is stored as minutes asleep per night (`sleep-nights.ts`).
 * The `Me` element (birth date, sex, blood type), device and app names are
 * never read into a row. Pure; stores nothing.
 */

type AppleType = Readonly<{
  measure: Measure;
  /** Source unit to the power of ten that turns it into the measure's unit. */
  units: Readonly<Record<string, number>>;
  /** Apple writes this as a fraction (0.97) under the unit `%`. */
  fraction?: true;
}>;

export const APPLE_TYPES: Readonly<Record<string, AppleType>> = {
  HKQuantityTypeIdentifierHeartRate: {
    measure: MEASURES.heartRate,
    units: { "count/min": 0 },
  },
  HKQuantityTypeIdentifierRestingHeartRate: {
    measure: MEASURES.restingHeartRate,
    units: { "count/min": 0 },
  },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: {
    measure: MEASURES.hrvSdnn,
    units: { ms: 0, s: 3 },
  },
  HKQuantityTypeIdentifierStepCount: { measure: MEASURES.steps, units: { count: 0 } },
  HKQuantityTypeIdentifierBodyMass: {
    measure: MEASURES.bodyMass,
    units: { kg: 0, g: -3 },
  },
  HKQuantityTypeIdentifierBodyMassIndex: {
    measure: MEASURES.bodyMassIndex,
    units: { count: 0 },
  },
  HKQuantityTypeIdentifierOxygenSaturation: {
    measure: MEASURES.oxygenSaturation,
    units: { "%": 2 },
    fraction: true,
  },
  HKQuantityTypeIdentifierRespiratoryRate: {
    measure: MEASURES.respiratoryRate,
    units: { "count/min": 0 },
  },
};

const SLEEP_TYPE = "HKCategoryTypeIdentifierSleepAnalysis";

const ASLEEP_VALUES: ReadonlySet<string> = new Set([
  "HKCategoryValueSleepAnalysisAsleep",
  "HKCategoryValueSleepAnalysisAsleepUnspecified",
  "HKCategoryValueSleepAnalysisAsleepCore",
  "HKCategoryValueSleepAnalysisAsleepDeep",
  "HKCategoryValueSleepAnalysisAsleepREM",
]);

const ELEMENTS: ReadonlySet<string> = new Set([
  "HealthData",
  "Me",
  "Record",
  "Workout",
  "ActivitySummary",
  "Correlation",
  "ClinicalRecord",
  "Audiogram",
  "VisionPrescription",
]);

/** `2026-09-01 07:12:00 +0200`, Apple's date form. */
const APPLE_DATE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/;

export type AppleDate = Readonly<{ time: EffectiveTime; localDay: string }>;

export const parseAppleDate = (raw: string | undefined): AppleDate | null => {
  const match = APPLE_DATE.exec((raw ?? "").trim());
  if (match === null) return null;
  const parsed = parseEffectiveTime(`${match[1]}T${match[2]}${match[3]}:${match[4]}`);
  return parsed.ok ? { time: parsed.time, localDay: match[1]! } : null;
};

const refusal = (code: string, message: string): ParsedImport => ({
  ok: false,
  refusal: { code, message },
});

const NOTES = [
  "Read from export.xml: heart rate, resting heart rate, HRV (SDNN), steps, body weight, BMI, blood oxygen and respiratory rate, one row per sample, and sleep as minutes asleep per night.",
  "Samples are stored as Apple Health recorded them; when two devices recorded the same minutes, both are kept.",
  "Sleep is counted per night on the day you woke up. Overlapping sleep samples are counted once; time in bed and awake time are not counted.",
  "Your details in the export (birth date, sex, blood type) and device and app names are never stored.",
];

type Scan = Readonly<{
  push: (text: string) => void;
  finish: () => ParsedImport;
}>;

const createAppleScan = (otherZipFiles: number): Scan => {
  const tally = createUnmappedTally();
  const observations: ObservationDraft[] = [];
  const sleep: SleepInterval[] = [];
  let records = 0;
  let sawRoot = false;
  let tooMany = false;

  const readQuantity = (
    type: string,
    known: AppleType,
    attributes: XmlElement["attributes"],
  ) => {
    const unit = attributes.unit ?? "";
    const places = known.units[unit];
    if (places === undefined) {
      tally.add(
        type,
        "unit-not-converted",
        `is in ${unit === "" ? "no unit" : unit}; only ${Object.keys(known.units).join(" or ")} is read for this type`,
      );
      return;
    }
    const raw = attributes.value ?? "";
    const value = shiftDecimal(raw, places);
    if (value === null) {
      tally.add(type, "not-a-number", "has a value that is not a plain number");
      return;
    }
    if (known.fraction === true && (Number(raw) < 0 || Number(raw) > 1)) {
      tally.add(
        type,
        "not-a-fraction",
        "is not a fraction between 0 and 1 as Apple Health writes it",
      );
      return;
    }
    const start = parseAppleDate(attributes.startDate);
    if (start === null) {
      tally.add(type, "bad-date", "has a start date this import cannot read");
      return;
    }
    if (observations.length >= MAX_ROWS) {
      tooMany = true;
      return;
    }
    observations.push(
      measureObservation(
        known.measure,
        value,
        start.time,
        `export.xml record ${records}`,
      ),
    );
  };

  const readSleep = (attributes: XmlElement["attributes"]) => {
    if (!ASLEEP_VALUES.has(attributes.value ?? "")) {
      tally.add(
        SLEEP_TYPE,
        "not-asleep",
        "is time in bed or awake, which is not counted as sleep",
      );
      return;
    }
    const start = parseAppleDate(attributes.startDate);
    const end = parseAppleDate(attributes.endDate);
    if (start === null || end === null) {
      tally.add(
        SLEEP_TYPE,
        "bad-date",
        "has a start or end date this import cannot read",
      );
      return;
    }
    sleep.push({
      night: end.localDay,
      startMs: start.time.at.getTime(),
      endMs: end.time.at.getTime(),
    });
  };

  const onElement = (element: XmlElement): "stop" | undefined => {
    switch (element.name) {
      case "HealthData":
        sawRoot = true;
        return undefined;
      case "Me":
        return undefined;
      case "Record": {
        records += 1;
        const type = element.attributes.type ?? "";
        const known = APPLE_TYPES[type];
        if (known !== undefined) readQuantity(type, known, element.attributes);
        else if (type === SLEEP_TYPE) readSleep(element.attributes);
        else
          tally.add(
            type || "Record",
            "unsupported-type",
            "is a type this import does not read",
          );
        return tooMany ? "stop" : undefined;
      }
      default:
        tally.add(element.name, "unsupported-element", "is not read in this version");
        return undefined;
    }
  };

  const scanner = createXmlElementScanner(ELEMENTS, onElement);

  return {
    push: scanner.push,
    finish: () => {
      const complete = scanner.end();
      if (tooMany) {
        return refusal(
          "too-many-rows",
          `The export has more than ${MAX_ROWS} samples of the types this import reads; the limit is ${MAX_ROWS}.`,
        );
      }
      if (!sawRoot) {
        return refusal("not-apple-health", "This is not an Apple Health export.xml.");
      }
      if (!complete) {
        return refusal("xml-incomplete", "The export.xml ends in the middle of a tag.");
      }
      const nights = sleepNights(sleep);
      const sleepRows = nights.flatMap((night) => {
        const day = parseEffectiveTime(night.night);
        return day.ok
          ? [
              measureObservation(
                MEASURES.sleepDuration,
                night.minutes,
                day.time,
                `export.xml sleep ${night.night}`,
              ),
            ]
          : [];
      });
      if (observations.length + sleepRows.length > MAX_ROWS) {
        return refusal(
          "too-many-rows",
          `The export has more than ${MAX_ROWS} samples of the types this import reads; the limit is ${MAX_ROWS}.`,
        );
      }
      return {
        ok: true,
        kind: "apple-health",
        observations: [...observations, ...sleepRows],
        unmapped: tally.list(),
        notes:
          otherZipFiles > 0
            ? [
                ...NOTES,
                `Only export.xml is read; the other ${otherZipFiles} files in the zip (clinical documents, routes, ECGs) are not.`,
              ]
            : NOTES,
      };
    },
  };
};

/** Bytes per decode step for a plain export.xml. */
const TEXT_CHUNK = 1 << 20;

/** UTF-8 decoding in steps; a byte sequence that is not UTF-8 marks the whole file. */
const decodeInto = (scan: Scan) => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let failed = false;
  const run = (decode: () => string) => {
    if (failed) return;
    try {
      scan.push(decode());
    } catch {
      failed = true;
    }
  };
  return {
    chunk: (bytes: Uint8Array) => run(() => decoder.decode(bytes, { stream: true })),
    end: () => run(() => decoder.decode()),
    failed: () => failed,
  };
};

const NOT_UTF8 = refusal("not-utf8", "The file is not UTF-8 text.");

const parseZip = (bytes: Uint8Array): ParsedImport => {
  const listing = readZipEntries(bytes);
  if (!listing.ok) return refusal("zip-unreadable", "The zip file could not be read.");
  const files = listing.entries.filter((entry) => !entry.name.endsWith("/"));
  const exportXml = files.find((entry) => baseName(entry.name) === "export.xml");
  if (exportXml === undefined) {
    return refusal(
      "no-export-xml",
      "The zip has no export.xml. Choose the export.zip from Apple Health, or the export.xml inside it.",
    );
  }
  const scan = createAppleScan(files.length - 1);
  const text = decodeInto(scan);
  if (!streamZipEntry(exportXml, text.chunk)) {
    return refusal("zip-unreadable", "The zip file could not be read.");
  }
  text.end();
  return text.failed() ? NOT_UTF8 : scan.finish();
};

export const parseAppleHealth = (bytes: Uint8Array): ParsedImport => {
  if (isZip(bytes)) return parseZip(bytes);
  const scan = createAppleScan(0);
  const text = decodeInto(scan);
  for (let start = 0; start < bytes.byteLength; start += TEXT_CHUNK) {
    text.chunk(bytes.subarray(start, start + TEXT_CHUNK));
  }
  text.end();
  return text.failed() ? NOT_UTF8 : scan.finish();
};

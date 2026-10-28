import { MAX_ROWS } from "./limits";
import { decodeUtf8 } from "./text-file";
import type { ObservationDraft, ParsedImport } from "./types";
import type { WearableLayout } from "./wearable-files";
import {
  FITBIT_RESTING_HEART_RATE,
  FITBIT_SAMPLES,
  FITBIT_SLEEP,
  FITBIT_WEIGHT,
} from "./wearable-fitbit";
import { createUnmappedTally, MEASURES } from "./wearable-measures";
import { OURA_JSON, OURA_TRENDS_CSV } from "./wearable-oura";
import { WHOOP_CYCLES, WHOOP_SLEEPS, WHOOP_WORKOUTS } from "./wearable-whoop";
import { baseName, isZip, readZipEntries, zipEntryBytes } from "./zip-entries";

/**
 * A wearable export file, or a zip of them: Oura, Whoop, or Fitbit data from
 * Google Takeout. Each file is matched to a layout by its name and header
 * (`wearable-*.ts`); a file no layout knows is listed in the review as
 * unsupported, never guessed at. Every layout gives the same drafts as the
 * other imports. Pure; stores nothing.
 */

export const WEARABLE_LAYOUTS: readonly WearableLayout[] = [
  WHOOP_CYCLES,
  WHOOP_SLEEPS,
  WHOOP_WORKOUTS,
  OURA_JSON,
  OURA_TRENDS_CSV,
  FITBIT_RESTING_HEART_RATE,
  FITBIT_SLEEP,
  FITBIT_WEIGHT,
  FITBIT_SAMPLES,
];

export const detectWearableLayout = (
  fileName: string,
  text: string,
): WearableLayout | null =>
  WEARABLE_LAYOUTS.find((layout) => layout.matches(baseName(fileName), text)) ?? null;

type WearableFile = Readonly<{ path: string; bytes: Uint8Array | null }>;

/** Archive metadata a zip tool adds; not the person's files. */
const isZipNoise = (path: string): boolean =>
  path.endsWith("/") || path.startsWith("__MACOSX/") || baseName(path) === ".DS_Store";

const SLEEP_NOTE =
  "Sleep is minutes asleep of the main sleep of each night, on the day you woke up; naps are not stored.";
const RMSSD_NOTE =
  "HRV from Oura and Whoop is RMSSD, which has no code here, so it is stored by name.";

/** The files in the upload: each entry of a zip, or the one file. Null for a broken zip. */
const filesOf = (fileName: string, bytes: Uint8Array): readonly WearableFile[] | null => {
  if (!isZip(bytes)) return [{ path: fileName || "file", bytes }];
  const listing = readZipEntries(bytes);
  return listing.ok
    ? listing.entries
        .filter((entry) => !isZipNoise(entry.name))
        .map((entry) => ({ path: entry.name, bytes: zipEntryBytes(entry) }))
    : null;
};

const notesFor = (
  read: readonly string[],
  observations: readonly ObservationDraft[],
): readonly string[] => {
  if (read.length === 0) return ["No file in this upload is one this import knows."];
  const has = (display: string) => observations.some((row) => row.display === display);
  return [
    ...read,
    ...(has(MEASURES.sleepDuration.display) ? [SLEEP_NOTE] : []),
    ...(has(MEASURES.hrvRmssd.display) ? [RMSSD_NOTE] : []),
  ];
};

export const parseWearableExport = (
  fileName: string,
  bytes: Uint8Array,
): ParsedImport => {
  const files = filesOf(fileName, bytes);
  if (files === null) {
    return {
      ok: false,
      refusal: { code: "zip-unreadable", message: "The zip file could not be read." },
    };
  }

  const tally = createUnmappedTally();
  const read: string[] = [];
  const observations: ObservationDraft[] = [];
  for (const file of files) {
    const text = file.bytes === null ? null : decodeUtf8(file.bytes);
    if (text === null) {
      tally.add(file.path, "unreadable", "could not be read as UTF-8 text");
      continue;
    }
    const layout = detectWearableLayout(file.path, text);
    if (layout === null) {
      tally.add(file.path, "unsupported-file", "is not a file this import knows");
      continue;
    }
    read.push(`Read ${file.path} as ${layout.label}.`);
    // One push per row: spreading a large file's rows into push() can overflow the stack.
    for (const row of layout.read({ name: baseName(file.path), text }, tally)) {
      observations.push(row);
    }
    if (observations.length > MAX_ROWS) {
      return {
        ok: false,
        refusal: {
          code: "too-many-rows",
          message: `The export has more than ${MAX_ROWS} numbers; the limit is ${MAX_ROWS}.`,
        },
      };
    }
  }

  return {
    ok: true,
    kind: "wearable",
    observations,
    unmapped: tally.list(),
    notes: notesFor(read, observations),
  };
};

import { parsePlainNumber } from "./decimal-text";
import { parseDelimited } from "./delimited";
import { type EffectiveTime, parseEffectiveTime } from "./effective-time";
import type { ObservationDraft } from "./types";
import type { UnmappedTally } from "./wearable-measures";

/**
 * Shared pieces for reading one file of a wearable export. A layout says
 * which files it reads (by name and header, never by guessing at values)
 * and turns one file into drafts, reporting every value it leaves out.
 */

export type WearableLayout = Readonly<{
  id: string;
  /** Shown in the review: "Whoop sleeps". */
  label: string;
  matches: (fileName: string, text: string) => boolean;
  read: (
    file: Readonly<{ name: string; text: string }>,
    tally: UnmappedTally,
  ) => readonly ObservationDraft[];
}>;

export type CsvTable = Readonly<{
  header: readonly string[];
  /** Each data row by column name; a missing field is "". */
  rows: readonly Readonly<Record<string, string>>[];
}>;

/** A comma-separated file with a header row, or null when it does not parse. */
export const readCsv = (text: string): CsvTable | null => {
  const parsed = parseDelimited(text, ",");
  if (!parsed.ok || parsed.rows.length === 0) return null;
  const [header, ...rest] = parsed.rows;
  const names = header!.map((cell) => cell.trim());
  return {
    header: names,
    rows: rest.map((row) =>
      Object.fromEntries(names.map((name, index) => [name, row[index] ?? ""])),
    ),
  };
};

/** The first line's comma-separated names, trimmed and unquoted. */
export const csvHeader = (text: string): readonly string[] => {
  const end = text.indexOf("\n");
  const line = (end === -1 ? text : text.slice(0, end)).replace(/^﻿/, "");
  return line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
};

export const hasColumns = (text: string, columns: readonly string[]): boolean => {
  const header = csvHeader(text);
  return columns.every((column) => header.includes(column));
};

/** JSON text to a value, or undefined when it does not parse. */
export const readJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A calendar day `2026-09-01` as a day-precision time. */
export const dayTime = (day: unknown): EffectiveTime | null => {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = parseEffectiveTime(day);
  return parsed.ok ? parsed.time : null;
};

/**
 * A number from a CSV cell or a JSON field. Missing (empty, null, absent)
 * and unreadable values are reported, never stored as zero.
 */
export const numberField = (
  raw: unknown,
  where: string,
  tally: UnmappedTally,
): number | null => {
  if (raw === undefined || raw === null || raw === "") {
    tally.add(where, "empty", "is empty");
    return null;
  }
  const value =
    typeof raw === "number"
      ? Number.isFinite(raw)
        ? raw
        : null
      : parsePlainNumber(String(raw));
  if (value === null) {
    tally.add(where, "not-a-number", "has a value that is not a plain number");
  }
  return value;
};

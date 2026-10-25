import { GBD_RELEASE_YEAR } from "./constants";
import type { GbdInput } from "./input";

export type GbdRow = {
  readonly measure: string;
  readonly cause: string;
  readonly location: string;
  readonly year: string;
  readonly sex: string;
  readonly age: string;
  readonly value: number;
  readonly lower: number | null;
  readonly upper: number | null;
  readonly unit: string;
  readonly source: string;
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const uiBound = (raw: Record<string, unknown>, index: 0 | 1): unknown =>
  Array.isArray(raw.ui) ? raw.ui[index] : undefined;

const fromObject = (
  raw: Record<string, unknown>,
  fields: GbdInput,
  releaseYear: string,
): GbdRow | null => {
  const value = asNumber(raw.value ?? raw.mean ?? raw.val);
  if (value === null) return null;
  return {
    measure: fields.measure,
    cause: fields.cause,
    location: fields.location,
    year: fields.year,
    sex: fields.sex,
    age: fields.age,
    value,
    lower: asNumber(raw.lower ?? uiBound(raw, 0)),
    upper: asNumber(raw.upper ?? uiBound(raw, 1)),
    unit: typeof raw.unit === "string" ? raw.unit : "",
    source: `IHME GBD ${releaseYear}`,
  };
};

const extractCandidates = (raw: unknown): Record<string, unknown>[] => {
  if (Array.isArray(raw)) {
    return raw.filter(isRecord);
  }
  if (!isRecord(raw)) return [];

  if (Array.isArray(raw.content)) {
    for (const part of raw.content) {
      if (!isRecord(part) || typeof part.text !== "string") continue;
      try {
        const nested = extractCandidates(JSON.parse(part.text) as unknown);
        if (nested.length > 0) return nested;
      } catch {
        // fail closed for this content part
      }
    }
    return [];
  }

  if (Array.isArray(raw.rows)) return extractCandidates(raw.rows);
  if (Array.isArray(raw.result)) return extractCandidates(raw.result);
  if ("value" in raw || "mean" in raw || "val" in raw) return [raw];
  return [];
};

export const normalizeGbdResult = (
  raw: unknown,
  fields: GbdInput,
  releaseYear = GBD_RELEASE_YEAR,
): GbdRow[] => {
  const rows: GbdRow[] = [];
  for (const candidate of extractCandidates(raw)) {
    const row = fromObject(candidate, fields, releaseYear);
    if (row) rows.push(row);
  }
  return rows;
};

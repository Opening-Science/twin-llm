import type { EffectivePrecision } from "./types";

/**
 * A date as written in an imported file. Accepted: `2024`, `2024-03`,
 * `2024-03-01`, or a date and time with a zone (`2024-03-01T08:30:00Z`,
 * `…+01:00`; a space may stand for the `T`). A time without a zone is
 * refused: reading it in this machine's zone would be a guess. Partial dates
 * are stored as their first instant in UTC with their precision, so a `2024`
 * is never shown as 1 January.
 */

export type EffectiveTime = Readonly<{ at: Date; precision: EffectivePrecision }>;

export type EffectiveTimeResult =
  | Readonly<{ ok: true; time: EffectiveTime }>
  | Readonly<{ ok: false; reason: "no-date" | "no-time-zone" | "not-a-date" }>;

const PARTIAL = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;
const WITH_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/;

const realDay = (year: number, month: number, day: number): Date | null => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
};

export const parseEffectiveTime = (
  raw: string | null | undefined,
): EffectiveTimeResult => {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: false, reason: "no-date" };

  const partial = PARTIAL.exec(text);
  if (partial) {
    const year = Number(partial[1]);
    const month = partial[2] === undefined ? 1 : Number(partial[2]);
    const day = partial[3] === undefined ? 1 : Number(partial[3]);
    const at = realDay(year, month, day);
    if (at === null) return { ok: false, reason: "not-a-date" };
    const precision: EffectivePrecision =
      partial[3] !== undefined ? "day" : partial[2] !== undefined ? "month" : "year";
    return { ok: true, time: { at, precision } };
  }

  const timed = WITH_TIME.exec(text);
  if (!timed) return { ok: false, reason: "not-a-date" };
  if (timed[8] === undefined) return { ok: false, reason: "no-time-zone" };
  const day = realDay(Number(timed[1]), Number(timed[2]), Number(timed[3]));
  const at = new Date(text.replace(" ", "T"));
  if (day === null || Number.isNaN(at.getTime()))
    return { ok: false, reason: "not-a-date" };
  return { ok: true, time: { at, precision: "instant" } };
};

export const EFFECTIVE_TIME_REASONS = {
  "no-date": "has no date",
  "no-time-zone":
    "has a time without a time zone; write the day only (2024-03-01) or add Z or +01:00",
  "not-a-date": "has a date that is not a calendar date (use 2024-03-01)",
} as const;

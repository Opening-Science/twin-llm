import { utcDay } from "@/infrastructure/day-key";
import { isoLocalDate } from "@/infrastructure/format-measure";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;
const DEFAULT_INCLUSIVE_DAYS = 14;
const MAX_INCLUSIVE_DAYS = 90;

export type SyncDateWindow = {
  readonly startDate: string;
  readonly endDate: string;
};

const defaultWindow = (): SyncDateWindow => {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (DEFAULT_INCLUSIVE_DAYS - 1));
  // The viewer's calendar day, not UTC: near midnight UTC is a day off.
  return { startDate: isoLocalDate(start), endDate: isoLocalDate(end) };
};

const parseUtcDate = (value: string): number | null => {
  if (!ISO_DATE_RE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  // Reject non-canonical dates (e.g. 2024-02-31 → March). UTC on purpose: this
  // only canonicalises a parsed YYYY-MM-DD, never "today".
  if (utcDay(new Date(ms)) !== value) return null;
  return ms;
};

/**
 * Resolve an optional YYYY-MM-DD sync window.
 * Defaults to the last 14 days (including today). Invalid input
 * (bad format, start > end, or more than 90 inclusive days) falls back.
 */
export const resolveSyncDateWindow = (options?: {
  readonly startDate?: string;
  readonly endDate?: string;
}): SyncDateWindow => {
  const startRaw = options?.startDate;
  const endRaw = options?.endDate;
  if (!startRaw || !endRaw) return defaultWindow();

  const startMs = parseUtcDate(startRaw);
  const endMs = parseUtcDate(endRaw);
  if (startMs === null || endMs === null) return defaultWindow();
  if (startMs > endMs) return defaultWindow();

  const inclusiveDays = Math.floor((endMs - startMs) / MS_PER_DAY) + 1;
  if (inclusiveDays > MAX_INCLUSIVE_DAYS) return defaultWindow();

  return { startDate: startRaw, endDate: endRaw };
};

const ymd = (day: string): [number, number, number] => {
  const [y, m, d] = day.split("-").map(Number);
  return [y!, m! - 1, d!];
};

const shiftDays = (day: string, days: number): string =>
  utcDay(new Date(Date.UTC(...ymd(day)) + days * MS_PER_DAY));

const earlier = (a: string, b: string) => (a < b ? a : b);
const later = (a: string, b: string) => (a > b ? a : b);

/**
 * How far the date pickers may go, so they never offer a day the window
 * refuses: From at most 90 days back from To, To at most 90 days after
 * From and never after today.
 */
export const windowLimits = (
  window: SyncDateWindow,
  today: string,
): Readonly<{ startMin: string; endMax: string }> => ({
  startMin: shiftDays(window.endDate, -(MAX_INCLUSIVE_DAYS - 1)),
  endMax: earlier(today, shiftDays(window.startDate, MAX_INCLUSIVE_DAYS - 1)),
});

/** A picked From, kept inside the limits; a cleared or malformed pick keeps the window. */
export const pickStartDate = (window: SyncDateWindow, picked: string): SyncDateWindow => {
  if (parseUtcDate(picked) === null) return window;
  const min = shiftDays(window.endDate, -(MAX_INCLUSIVE_DAYS - 1));
  return {
    startDate: earlier(later(picked, min), window.endDate),
    endDate: window.endDate,
  };
};

/** A picked To, kept inside the limits; a cleared or malformed pick keeps the window. */
export const pickEndDate = (
  window: SyncDateWindow,
  picked: string,
  today: string,
): SyncDateWindow => {
  if (parseUtcDate(picked) === null) return window;
  const { endMax } = windowLimits(window, today);
  return {
    startDate: window.startDate,
    endDate: later(earlier(picked, endMax), window.startDate),
  };
};

/** UTC day bounds for Whoop (and similar) timestamp APIs. */
export const syncWindowToUtcTimestamps = (window: SyncDateWindow) => ({
  start: `${window.startDate}T00:00:00.000Z`,
  end: `${window.endDate}T23:59:59.999Z`,
});

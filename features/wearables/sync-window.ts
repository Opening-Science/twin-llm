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

/** UTC day bounds for Whoop (and similar) timestamp APIs. */
export const syncWindowToUtcTimestamps = (window: SyncDateWindow) => ({
  start: `${window.startDate}T00:00:00.000Z`,
  end: `${window.endDate}T23:59:59.999Z`,
});

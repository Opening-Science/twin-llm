import { z } from "zod";

import { type KioskDay, kioskDaySchema } from "@/packages/query-tools/kiosk-day";

/**
 * What the "Show me my day" panel reads from its routes, parsed on arrival.
 * The panel draws these as given; nothing here computes a value.
 */

export type DayListEntry = Readonly<{ day: string; readings: number }>;

/** The picker's value for the illustrative mock day; a real day is YYYY-MM-DD. */
export const MOCK_CHOICE = "mock";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isEntry = (value: unknown): value is DayListEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.day === "string" &&
    DAY.test(entry.day) &&
    typeof entry.readings === "number"
  );
};

/** The days of a `/api/digital-twin/days` body, or null when it is not one. */
export const parseDayList = (body: unknown): readonly DayListEntry[] | null => {
  const days =
    body && typeof body === "object" ? (body as { days?: unknown }).days : undefined;
  return Array.isArray(days) && days.every(isEntry) ? days : null;
};

/** The kiosk day of a `/api/digital-twin/day` body, or null when it does not parse. */
export const parseDay = (body: unknown): KioskDay | null => {
  const day =
    body && typeof body === "object" ? (body as { day?: unknown }).day : undefined;
  const parsed = kioskDaySchema.safeParse(day);
  return parsed.success ? parsed.data : null;
};

/** The sentence of an error body; only the routes' own copy ever lands here. */
export const parseError = (body: unknown): string | null => {
  const error =
    body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  return typeof error === "string" ? error : null;
};

/** The URL a choice reads: the mock route, or the person's day. */
export const dayUrl = (choice: string, personRef: string, profile: string): string =>
  choice === MOCK_CHOICE
    ? `/api/digital-twin/day?profile=${profile}`
    : `/api/digital-twin/day/${encodeURIComponent(personRef)}?day=${choice}&profile=${profile}`;

/** The chosen day while it is listed (or the mock), else the newest day, else the mock. */
export const pickChoice = (
  days: readonly DayListEntry[] | null | undefined,
  chosen: string | null,
): string => {
  if (chosen === MOCK_CHOICE) return MOCK_CHOICE;
  const listed = days ?? [];
  return (
    listed.find((entry) => entry.day === chosen)?.day ?? listed[0]?.day ?? MOCK_CHOICE
  );
};

const periodSummarySchema = z
  .object({
    period: z.enum(["week", "month"]),
    start: z.iso.date(),
    end: z.iso.date(),
    title: z.string().min(1),
    lines: z.array(
      z.object({ label: z.string().min(1), text: z.string().min(1) }).strict(),
    ),
    notes: z.array(z.string().min(1)),
  })
  .strict();

export type PeriodView = z.infer<typeof periodSummarySchema>;

/** The summary of a `/api/digital-twin/period` body, or null when it does not parse. */
export const parsePeriod = (body: unknown): PeriodView | null => {
  const period =
    body && typeof body === "object" ? (body as { period?: unknown }).period : undefined;
  const parsed = periodSummarySchema.safeParse(period);
  return parsed.success ? parsed.data : null;
};

/** The URL of a person's week or month ending on a day; null for the mock. */
export const periodUrl = (
  choice: string,
  personRef: string,
  period: "week" | "month",
  profile: string,
): string | null =>
  choice === MOCK_CHOICE
    ? null
    : `/api/digital-twin/period/${encodeURIComponent(personRef)}?period=${period}&end=${choice}&profile=${profile}`;

import "server-only";

import type { z } from "zod";

import { type DayBeat } from "./day-beat";
import {
  DAY_THRESHOLDS,
  type DayReading,
  dayBeats,
  type GlucoseProfile,
  type RedWindow,
  redWindows,
} from "./day-beats";
import {
  defaultQueryToolPorts,
  type ObservationRecord,
  type QueryToolPorts,
} from "./ports";
import { isToolRefusal, mixedUnits, type ToolRefusal } from "./refusals";
import { type showMyDayInput } from "./schemas";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import { audited, distinctUnits, readWindow, subjectInScope } from "./tool-core";

/**
 * `show_my_day`: one synthetic person's day of heart rate and glucose as
 * beats and red windows (`day-beats.ts`). Scope first, one capped read of
 * three codes over the UTC day, audited. The warehouse stores no events and
 * no activity, so each beat's event is "Reading" and the still-heart-rate
 * rule is not applied to a warehouse day.
 */

export const HEART_RATE_LOINC = "8867-4";
/** Glucose in blood, and in serum or plasma. */
export const GLUCOSE_LOINCS = ["2339-0", "2345-7"] as const;
const UNITS = { heart: "/min", glucose: "mg/dL" } as const;

type ShowMyDayInput = z.infer<typeof showMyDayInput>;

export type ShowMyDayResult = Readonly<{
  subject_ref: string;
  day: string;
  profile: GlucoseProfile;
  /** Rows read. */
  n: number;
  beats: readonly DayBeat[];
  red_windows: readonly RedWindow[];
  /** The thresholds behind the red windows, and who still has to confirm them. */
  thresholds: Readonly<{ status: "placeholder"; reviewer: string }>;
  activity: "not recorded";
}>;

const isGlucose = (loinc: string): boolean =>
  (GLUCOSE_LOINCS as readonly string[]).includes(loinc);

/** Rows to readings, one per UTC minute, heart rate and glucose side by side. */
export const readingsFromRows = (
  rows: readonly ObservationRecord[],
): readonly DayReading[] => {
  const byMinute = rows.reduce<Map<string, DayReading>>((acc, row) => {
    const time = row.effectiveAt.toISOString().slice(11, 16);
    const current: DayReading = acc.get(time) ?? {
      time,
      event: null,
      heartRatePerMin: null,
      glucoseMgDl: null,
      moving: null,
    };
    acc.set(
      time,
      isGlucose(row.loinc)
        ? { ...current, glucoseMgDl: row.value }
        : { ...current, heartRatePerMin: row.value },
    );
    return acc;
  }, new Map());
  return [...byMinute.values()].sort((a, b) => a.time.localeCompare(b.time));
};

/** Heart rate in /min and glucose in mg/dL only; anything else is refused, never converted. */
const unitRefusal = (rows: readonly ObservationRecord[]): ToolRefusal | null => {
  const heart = distinctUnits(rows.filter((row) => row.loinc === HEART_RATE_LOINC));
  if (heart.some((unit) => unit !== UNITS.heart)) {
    return mixedUnits(HEART_RATE_LOINC, [...new Set([UNITS.heart, ...heart])]);
  }
  const glucose = rows.filter((row) => isGlucose(row.loinc));
  const glucoseUnits = distinctUnits(glucose);
  if (glucoseUnits.some((unit) => unit !== UNITS.glucose)) {
    return mixedUnits(glucose[0]?.loinc ?? GLUCOSE_LOINCS[0], [
      ...new Set([UNITS.glucose, ...glucoseUnits]),
    ]);
  }
  return null;
};

export const runShowMyDay = (
  scope: SessionScope,
  input: ShowMyDayInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<ShowMyDayResult | ToolRefusal> =>
  audited<ShowMyDayResult | ToolRefusal>(
    scope,
    "show_my_day",
    input,
    input.subject_ref,
    async () => {
      if (!(await subjectInScope(scope, input.subject_ref, ports))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      const rows = await readWindow(
        ports,
        input.subject_ref,
        [HEART_RATE_LOINC, ...GLUCOSE_LOINCS],
        { start: input.day, end: input.day },
      );
      if (isToolRefusal(rows)) return rows;
      const refusal = unitRefusal(rows);
      if (refusal) return refusal;
      const readings = readingsFromRows(rows);
      return {
        subject_ref: input.subject_ref,
        day: input.day,
        profile: input.profile,
        n: rows.length,
        beats: dayBeats(readings, input.profile),
        red_windows: redWindows(readings, input.profile),
        thresholds: { status: DAY_THRESHOLDS.status, reviewer: DAY_THRESHOLDS.reviewer },
        activity: "not recorded",
      };
    },
    (result) => ("n" in result ? result.n : 0),
    ports,
  );

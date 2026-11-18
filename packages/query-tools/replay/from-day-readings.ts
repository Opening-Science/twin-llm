import { type DayReading } from "../day-beats";
import { median } from "../stats";
import { type Origin, type ReplayEvent, type ReplayReading } from "./items";
import { localInstant } from "./local-time";
import { DEMO_NOTICE, type ReplayDay, replayDaySchema } from "./replay-day";

/**
 * The readings `show_my_day` already builds (`DayReading`, from the warehouse
 * or the illustrative mock day) as a replay day, so the replay reads the same
 * values the day beats do. Nothing is added: no activity, no meal, no value.
 *
 * - Heart rate, blood glucose and sensor glucose become measured readings of
 *   the named device; blood and sensor stay two series.
 * - An event tag the person entered becomes an entered event at its time. It
 *   is a meal only when it names one plainly ("Breakfast", "Large dinner"),
 *   never when a meal is only mentioned ("Walk after lunch", "After dinner").
 * - `moving` is not turned into an activity: it does not say walk or run.
 * - A reading stands for the usual spacing of its series; a lone reading for
 *   an hour.
 */

export type DayReadingsSource = Readonly<{
  subject_ref: string;
  day: string;
  /** The zone the readings' "HH:MM" times are in: `show_my_day` uses UTC. */
  time_zone: string;
  origin: Origin;
  /** The device the values came from, as it should be shown. */
  device: string;
}>;

const MEAL_TAG =
  /^(?:(?!after |before |post |pre )[a-z]+ )?(breakfast|lunch|snack|dinner)$/i;

/** The meal a tag plainly names, or null. */
export const mealOfTag = (
  tag: string,
): "breakfast" | "lunch" | "snack" | "dinner" | null => {
  const found = MEAL_TAG.exec(tag.trim())?.[1]?.toLowerCase();
  return found === "breakfast" ||
    found === "lunch" ||
    found === "snack" ||
    found === "dinner"
    ? found
    : null;
};

const LONE_READING_MIN = 60;

const spacingOf = (instants: readonly number[]): number => {
  const sorted = [...instants].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((at, index) => (at - (sorted[index] ?? at)) / 60_000);
  return median(gaps.filter((gap) => gap > 0)) ?? LONE_READING_MIN;
};

/** The readings of one day as a replay day. Throws when they do not fit the day. */
export const replayDayFromDayReadings = (
  source: DayReadingsSource,
  readings: readonly DayReading[],
): ReplayDay => {
  const scope = {
    subject_ref: source.subject_ref,
    day: source.day,
    time_zone: source.time_zone,
    origin: source.origin,
  } as const;
  const device = { kind: "device", name: source.device } as const;
  const instantOf = (reading: DayReading): string =>
    localInstant(source.day, reading.time, source.time_zone).toISOString();
  const series = [
    {
      id: "hr",
      valueOf: (reading: DayReading) => reading.heartRatePerMin,
      shape: { stream: "heart_rate", unit: "/min" },
    },
    {
      id: "bg",
      valueOf: (reading: DayReading) => reading.glucoseMgDl,
      shape: { stream: "glucose", unit: "mg/dL", specimen: "blood" },
    },
    {
      id: "sg",
      valueOf: (reading: DayReading) => reading.sensorGlucoseMgDl ?? null,
      shape: { stream: "glucose", unit: "mg/dL", specimen: "sensor" },
    },
  ] as const;
  const replayReadings = series.flatMap(({ id, valueOf, shape }) => {
    const present = readings.flatMap((reading) => {
      const value = valueOf(reading);
      return value === null ? [] : [{ at: instantOf(reading), value }];
    });
    const interval = spacingOf(present.map((one) => Date.parse(one.at)));
    return present.map(({ at, value }): ReplayReading => ({
      ...scope,
      ...shape,
      id: `${id}-${at}`,
      at,
      interval_min: interval,
      provenance: "measured",
      source: device,
      availability: "available",
      value,
    }));
  });
  const events = readings.flatMap((reading): readonly ReplayEvent[] => {
    if (reading.event === null) return [];
    const at = instantOf(reading);
    const meal = mealOfTag(reading.event);
    return [
      {
        ...scope,
        id: `tag-${at}`,
        ...(meal === null ? { kind: "tag" } : { kind: "meal", meal }),
        label: reading.event,
        from: at,
        to: at,
        provenance: "entered",
        source: { kind: "person", name: "Tag entered by the person" },
      },
    ];
  });
  return replayDaySchema.parse({
    ...scope,
    notice: source.origin === "synthetic_demo" ? DEMO_NOTICE : null,
    readings: replayReadings,
    events,
    narrations: [],
  });
};

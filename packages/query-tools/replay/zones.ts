import { evidenceRef } from "./baseline";
import { isAvailable, type ReplayReading } from "./items";
import { localDayBounds, minutesBetween } from "./local-time";
import { type ReplayDay } from "./replay-day";

/**
 * Minutes a day spent in each heart-rate zone (#866): light, moderate,
 * intense, very intense. Pure, free of I/O. The result is derived.
 *
 * - The maximum heart rate is an estimate from age, never measured: Tanaka,
 *   Monahan and Seals (2001), 208 − 0.7 × age.
 * - The bands are shares of that maximum from the ACSM position stand
 *   (Garber et al. 2011, table 4): light, moderate, vigorous and near-maximal,
 *   named here light, moderate, intense and very intense. Below light is no
 *   zone.
 * - Each available heart-rate reading counts for the time it stands for
 *   (`interval_min`), cut short at the next heart-rate reading and the day's
 *   end, so 15-minute and one-minute samples never count a minute twice. A
 *   missing reading, or no reading, counts as no zone at all: a gap stays a gap.
 * - Without the person's age there is no estimate, and the result says
 *   "unavailable: no age" instead of guessing one.
 */

/** Tanaka H, Monahan KD, Seals DR. J Am Coll Cardiol 2001;37(1):153–156. */
export const MAX_HEART_RATE_FORMULA = {
  intercept: 208,
  per_year: 0.7,
  text: "Estimated maximum heart rate 208 − 0.7 × age (Tanaka, Monahan and Seals, 2001); an estimate, not measured.",
} as const;

export const ZONE_IDS = ["light", "moderate", "intense", "very_intense"] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

export type ZoneBand = Readonly<{
  id: ZoneId;
  label: string;
  /** Share of the estimated maximum, in per cent, from (inclusive) … */
  from_pct: number;
  /** … to (exclusive); null for the top band. */
  to_pct: number | null;
}>;

/**
 * Garber CE et al. ACSM position stand. Med Sci Sports Exerc
 * 2011;43(7):1334–1359, table 4, % of maximum heart rate: light 57–63,
 * moderate 64–76, vigorous 77–95, near-maximal 96 and over.
 */
export const HEART_RATE_ZONES: readonly ZoneBand[] = [
  { id: "light", label: "Light", from_pct: 57, to_pct: 64 },
  { id: "moderate", label: "Moderate", from_pct: 64, to_pct: 77 },
  { id: "intense", label: "Intense", from_pct: 77, to_pct: 96 },
  { id: "very_intense", label: "Very intense", from_pct: 96, to_pct: null },
];

export const ZONE_RULE = {
  id: "heart_rate_zone_minutes",
  text: "Minutes of heart rate at 57–63, 64–76, 77–95 and 96% or more of the age-estimated maximum (ACSM, Garber et al. 2011); maximum 208 − 0.7 × age (Tanaka 2001).",
} as const;

export const NO_AGE_TEXT = "unavailable: no age";

/** The synthetic person's record: only what the zones need. */
export type PersonRecord = Readonly<{ subject_ref: string; age_years: number | null }>;

export type ZoneMinutes =
  | Readonly<{
      state: "available";
      provenance: "derived";
      source: "TwinLLM";
      rule: Readonly<{ id: string; text: string }>;
      evidence: readonly string[];
      age_years: number;
      /** An estimate from age, not measured. */
      estimated_max_heart_rate_per_min: number;
      minutes: Readonly<Record<ZoneId, number>>;
      /** Minutes with a heart rate below the light band. */
      no_zone_min: number;
      /** Minutes with a heart rate at all; the rest of the day is a gap. */
      heart_rate_min: number;
    }>
  | Readonly<{
      state: "unavailable";
      reason: "no_age" | "other_person" | "no_heart_rate";
      text: string;
    }>;

export const estimatedMaxHeartRate = (ageYears: number): number =>
  MAX_HEART_RATE_FORMULA.intercept - MAX_HEART_RATE_FORMULA.per_year * ageYears;

/** The zone a share of the maximum falls in, or null below the light band. */
export const zoneOf = (sharePct: number): ZoneId | null =>
  HEART_RATE_ZONES.find(
    (band) =>
      sharePct >= band.from_pct && (band.to_pct === null || sharePct < band.to_pct),
  )?.id ?? null;

const usableAge = (age: number | null): age is number =>
  age !== null && Number.isFinite(age) && age > 0;

const NO_ZONES: Readonly<Record<ZoneId, number>> = {
  light: 0,
  moderate: 0,
  intense: 0,
  very_intense: 0,
};

type Counted = Readonly<{ reading: ReplayReading; value: number; minutes: number }>;

/** Each available reading's minutes: its interval, cut at the next reading and the day's end. */
const countedReadings = (day: ReplayDay): readonly Counted[] => {
  const dayEnd = localDayBounds(day.day, day.time_zone).end.getTime();
  const series = day.readings
    .filter((reading) => reading.stream === "heart_rate")
    .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return series.flatMap((reading, index) => {
    if (!isAvailable(reading)) return [];
    const from = Date.parse(reading.at);
    const next = series[index + 1];
    const until = Math.min(
      from + reading.interval_min * 60_000,
      next === undefined ? dayEnd : Date.parse(next.at),
      dayEnd,
    );
    const minutes = minutesBetween(new Date(from), new Date(Math.max(from, until)));
    return minutes > 0 ? [{ reading, value: reading.value, minutes }] : [];
  });
};

/** Minutes in each zone on `day`, for `person`; unavailable without an age or a heart rate. */
export const zoneMinutes = (day: ReplayDay, person: PersonRecord): ZoneMinutes => {
  if (person.subject_ref !== day.subject_ref) {
    return {
      state: "unavailable",
      reason: "other_person",
      text: "unavailable: the person record is not this day's person",
    };
  }
  if (!usableAge(person.age_years)) {
    return { state: "unavailable", reason: "no_age", text: NO_AGE_TEXT };
  }
  const counted = countedReadings(day);
  if (counted.length === 0) {
    return {
      state: "unavailable",
      reason: "no_heart_rate",
      text: "unavailable: no heart rate recorded",
    };
  }
  const maximum = estimatedMaxHeartRate(person.age_years);
  const totals = counted.reduce(
    (sum, one) => {
      const zone = zoneOf((one.value / maximum) * 100);
      return zone === null
        ? { ...sum, none: sum.none + one.minutes }
        : { ...sum, zones: { ...sum.zones, [zone]: sum.zones[zone] + one.minutes } };
    },
    { zones: NO_ZONES, none: 0 },
  );
  return {
    state: "available",
    provenance: "derived",
    source: "TwinLLM",
    rule: ZONE_RULE,
    evidence: [
      `person:${person.subject_ref}/age_years`,
      ...counted.map((one) => evidenceRef(one.reading)),
    ],
    age_years: person.age_years,
    estimated_max_heart_rate_per_min: maximum,
    minutes: totals.zones,
    no_zone_min: totals.none,
    heart_rate_min: counted.reduce((sum, one) => sum + one.minutes, 0),
  };
};

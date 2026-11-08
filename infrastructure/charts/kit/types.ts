/**
 * The chart kit's data and prop types, in one place so the wearables and Lab
 * screens import them from `infrastructure/charts/kit` alongside the
 * components.
 *
 * Every chart takes plain data, a `category` (its colour comes from
 * CATEGORY_TOKEN) and a `state`. Display strings such as hero numbers arrive
 * formatted: the screen knows the unit and the locale, the kit only draws.
 * Sentences arrive as props too; the kit writes no copy of its own beyond
 * axis words (MIN, MAX, weekday letters).
 */

import type { ReactNode } from "react";

import type { Category } from "../category-token";
import type {
  DaySample,
  Estimate,
  RadarAxis,
  Range,
  RingPart,
  SleepStage,
  StageSpan,
  StreakDay,
} from "./kit-geometry";

export type { Category } from "../category-token";
export type {
  DaySample,
  Estimate,
  RadarAxis,
  Range,
  RingPart,
  SleepStage,
  StageSpan,
  StreakDay,
} from "./kit-geometry";

/** default draws the data; loading draws its shape; empty draws the outline of the chart to come. */
export type ChartState = "default" | "loading" | "empty";

type Base = Readonly<{
  category: Category;
  state?: ChartState;
}>;

/** C03: label row, one sentence, a hairline, one body. */
export type InsightCardProps = Base &
  Readonly<{
    /** A noun, optionally scoped: "Sleep: Stages". */
    label: string;
    /** The one insight sentence; also what a screen reader reads for the chart. */
    sentence: string;
    /** Shown under the chart when state is empty, e.g. "7 nights needed". */
    emptyNote?: string;
    children?: ReactNode;
  }>;

/** A labelled hero value: "Today" and "8,492 steps". */
export type HeroValue = Readonly<{ label: string; value: string; unit?: string }>;

/** C04: today in the category colour, the reference in grey. */
export type ComparisonPairProps = Base &
  Readonly<{ today: HeroValue; reference: HeroValue }>;

/** C05: today's running total against the usual one, `now` from 0 to 1. */
export type CumulativeDayProps = Base &
  Readonly<{
    today: readonly DaySample[];
    average: readonly DaySample[];
    now: number;
    /** Three axis words, e.g. ["12 AM", "12 PM", "12 AM"]. */
    axis?: readonly [string, string, string];
  }>;

/** C06: seven bars and an average line spanning the card. */
export type WeeklyBarsProps = Base &
  Readonly<{
    values: readonly (number | null)[];
    average: number | null;
    caption: string;
    hero: string;
    unit?: string;
    weekStart?: 0 | 1;
  }>;

/** C07: done days filled, other days on the track, today outlined. */
export type StreakGridProps = Base &
  Readonly<{ days: readonly StreakDay[]; today: string; weekStart?: 0 | 1 }>;

/** C08: one bar from minimum to maximum per bucket, MIN and MAX written. */
export type RangeBarsProps = Base &
  Readonly<{
    buckets: readonly (Range | null)[];
    /** Start and end words for the axis, e.g. ["6 AM", "Now"]. */
    axis?: readonly [string, string];
    /** How a MIN/MAX number is written; defaults to whole numbers. */
    format?: (value: number) => string;
  }>;

/** C09: four lanes with a duration under each label. */
export type HypnogramProps = Base &
  Readonly<{
    spans: readonly StageSpan[];
    /** Lane words; defaults to Awake, REM, Core, Deep. */
    labels?: Readonly<Partial<Record<SleepStage, string>>>;
    /** Start and end words for the axis, e.g. ["11:04 PM", "6:31 AM"]. */
    axis?: readonly [string, string];
    /** How a duration in the spans' unit is written; defaults to "1 hr 5 min" from minutes. */
    duration?: (amount: number) => string;
  }>;

/** C10: a segmented ring with the score inside and a breakdown beside it. */
export type ScoreRingProps = Base &
  Readonly<{
    title: string;
    /** A describing word for the band, e.g. "High". */
    band: string;
    parts: readonly (RingPart & { label: string })[];
  }>;

/** C12: this month in the category colour, last month on the track. */
export type MonthComparisonProps = Base &
  Readonly<{
    current: Readonly<{ month: string; value: number | null; display: string }>;
    previous: Readonly<{ month: string; value: number | null; display: string }>;
  }>;

/** C13: daily bars in grey, the last one highlighted, and a target line. */
export type ConsistencyProps = Base &
  Readonly<{
    values: readonly (number | null)[];
    target: number | null;
    reference: HeroValue;
    last: HeroValue;
    axis?: readonly [string, string];
  }>;

/** R1: a research figure. */
export type ResearchFigureProps = Base &
  (
    | Readonly<{
        kind: "estimates";
        estimates: readonly Estimate[];
        /** A null, control or expected value, drawn as a grey rule. */
        reference?: Readonly<{ value: number; label: string }>;
        domain?: readonly [number, number];
      }>
    | Readonly<{
        kind: "pairs";
        /** One group per dataset; each group has two estimates, e.g. sensitivity and specificity. */
        groups: readonly Readonly<{
          label: string;
          estimates: readonly [Estimate, Estimate];
        }>[];
      }>
    | Readonly<{
        kind: "null";
        draws: readonly number[];
        observed: number;
        observedLabel: string;
        format?: (value: number) => string;
      }>
  );

/** R2: one Lab result: what was checked, the outcome word and its numbers. */
export type LabResultCardProps = Base &
  Readonly<{
    title: string;
    /** The outcome is always a word; colour only follows it. */
    outcome: Readonly<{ word: string; tone: "pass" | "fail" | "neutral" }>;
    sentence: string;
    rows: readonly Readonly<{ label: string; value: string }>[];
  }>;

/** C18: three to about eight axes, each on its own 0 to max; today against the reference. */
export type RadarProps = Base & Readonly<{ axes: readonly RadarAxis[] }>;

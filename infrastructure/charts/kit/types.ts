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

import type { Category, SeriesToken } from "../category-token";
import type {
  AxisScale,
  DaySample,
  Estimate,
  NullSummary,
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

/**
 * A chart given readouts becomes interactive: one tab stop, scrubbed by
 * hover, a finger or the arrow keys, with a readout line above it saying
 * the focused point. Without readouts it stays a picture under the
 * sentence. Put such a chart in an `InsightCard` with `interactive`.
 */
export type Interactive = Readonly<{
  /** Names the chart for a keyboard or screen-reader user; use the card's label. */
  label?: string;
  /** A point focused from the start, for example in the gallery. */
  defaultFocus?: number;
}>;

/** The ranges a card can switch between; the card only reports the choice. */
export type ChartRange = "day" | "week" | "month";

/** C03: label row, one sentence, a hairline, one body. */
export type InsightCardProps = Base &
  Readonly<{
    /** A study series colour in place of the category's: a study is not a wearable category. */
    series?: SeriesToken;
    /** A noun, optionally scoped: "Sleep: Stages". */
    label: string;
    /** The one insight sentence; also what a screen reader reads for the chart. */
    sentence: string;
    /** Shown under the chart when state is empty, e.g. "7 nights needed". */
    emptyNote?: string;
    /**
     * The body holds an interactive chart: it is not hidden, since the
     * chart's group and readout are its accessible layer.
     */
    interactive?: boolean;
    /** A Day / Week / Month switch in the card's header; the caller swaps the data. */
    ranges?: Readonly<{
      value: ChartRange;
      onChange: (range: ChartRange) => void;
      options?: readonly ChartRange[];
    }>;
    children?: ReactNode;
  }>;

/** A labelled hero value: "Today" and "8,492 steps". */
export type HeroValue = Readonly<{ label: string; value: string; unit?: string }>;

/** C04: today in the category colour, the reference in grey. */
export type ComparisonPairProps = Base &
  Readonly<{ today: HeroValue; reference: HeroValue }>;

/** C05: today's running total against the usual one, `now` from 0 to 1. */
export type CumulativeDayProps = Base &
  Interactive &
  Readonly<{
    today: readonly DaySample[];
    average: readonly DaySample[];
    now: number;
    /** Three axis words, e.g. ["12 AM", "12 PM", "12 AM"]. */
    axis?: readonly [string, string, string];
  }>;

/** C06: seven bars and an average line spanning the card. */
export type WeeklyBarsProps = Base &
  Interactive &
  Readonly<{
    values: readonly (number | null)[];
    /** One readout per value, e.g. "Tue · 9,140 steps"; makes the chart interactive. */
    readouts?: readonly (string | null)[];
    average: number | null;
    caption: string;
    hero: string;
    unit?: string;
    weekStart?: 0 | 1;
  }>;

/** C07: done days filled, other days on the track, today outlined. */
export type StreakGridProps = Base &
  Interactive &
  Readonly<{ days: readonly StreakDay[]; today: string; weekStart?: 0 | 1 }>;

/** C08: one bar from minimum to maximum per bucket, MIN and MAX written. */
export type RangeBarsProps = Base &
  Interactive &
  Readonly<{
    buckets: readonly (Range | null)[];
    /** Start and end words for the axis, e.g. ["6 AM", "Now"]. */
    axis?: readonly [string, string];
    /** How a MIN/MAX number is written; defaults to whole numbers. */
    format?: (value: number) => string;
    /** The unit after MIN and MAX numbers, e.g. "bpm": "MAX 114 bpm". */
    unit?: string;
  }>;

/** C09: four lanes with a duration under each label. */
export type HypnogramProps = Base &
  Interactive &
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
  Interactive &
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
  Interactive &
  Readonly<{
    values: readonly (number | null)[];
    /** One readout per night, e.g. "3 Nov · 11:48 PM"; makes the chart interactive. */
    readouts?: readonly (string | null)[];
    target: number | null;
    reference: HeroValue;
    last: HeroValue;
    axis?: readonly [string, string];
  }>;

/** R1: a research figure. */
export type ResearchFigureProps = Base &
  Interactive &
  Readonly<{
    /** A study series colour in place of the category's; rows with their own `series` keep theirs. */
    series?: SeriesToken;
  }> &
  (
    | Readonly<{
        kind: "estimates";
        /** Rows may carry `series` (shared colour, named in a legend) and `expected` (a grey tick). */
        estimates: readonly Estimate[];
        /** A null, control or expected value, drawn as a grey rule. */
        reference?: Readonly<{ value: number; label: string }>;
        domain?: readonly [number, number];
        /** "log" for ratios: ticks at 0.5, 1, 2, 4, 8. */
        scale?: AxisScale;
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
        /** The null's draws, drawn as a histogram… */
        draws?: readonly number[];
        /** …or its summary, drawn as a band with its mean. */
        summary?: NullSummary;
        /** Words under the null's mean when given as a summary, e.g. "Shuffled, 200 runs". */
        nullLabel?: string;
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
export type RadarProps = Base & Interactive & Readonly<{ axes: readonly RadarAxis[] }>;

/**
 * A vendor's own logo file, shown unmodified: never recoloured, cropped or
 * redrawn. `width` and `height` are the file's own proportions; the row
 * draws it `size` pixels high (30 by default) centred on its tile. `darkSrc` is the vendor's version for dark
 * backgrounds, when the guidelines give one. `attribution` is the word
 * the vendor asks for with its data, such as "Data by"; the row leads its
 * detail line with it and the vendor's name.
 */
export type VendorLogo = Readonly<{
  src: string;
  darkSrc?: string;
  alt: string;
  width: number;
  height: number;
  size?: number;
  attribution?: string;
}>;

/** One device or source in a C15 list. */
export type DeviceRow = Readonly<{
  name: string;
  /** A short line under the name, e.g. "Synced 4 minutes ago". */
  detail?: string;
  /** A word on the right; colour follows the word, never replaces it. */
  status?: Readonly<{ word: string; tone: "ok" | "warn" | "neutral" }>;
  logo?: VendorLogo;
  /** Makes the row a link with a chevron. */
  href?: string;
}>;

/** C15: a titled group of rows, one per device or source. */
export type DeviceListProps = Base &
  Readonly<{
    title: string;
    rows: readonly DeviceRow[];
    /** Shown in place of the rows when state is empty, e.g. "No device linked yet". */
    emptyNote?: string;
  }>;

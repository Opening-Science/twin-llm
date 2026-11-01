import { z } from "zod";

import { TWIN_FOCUS_IDS } from "@/packages/anatomy/twin-focus";

/**
 * The spec of every view kind, as zod schemas. A view reaches the browser in
 * a stream part and comes back from a stored tool part, so `toChatView`
 * parses it with these before anything draws it. Pure and browser-safe.
 *
 * Every number in a spec is one an audited query returned or one the server
 * computed from those rows (a mean, a trend direction); the model never
 * supplies one.
 */

const windowSpec = z.object({ start: z.string(), end: z.string() });

/** z.number() already refuses NaN and ±Infinity. */
const pointSpec = z.object({ at: z.string(), value: z.number() });

export const timeseriesSpecSchema = z.object({
  /** A LOINC code or a wearable key stem such as `sleep.score`. */
  measure: z.string(),
  label: z.string(),
  unit: z.string().nullable(),
  window: windowSpec,
  /** The synthetic subject_ref for a cohort measure; null for the user's wearables. */
  subject: z.string().nullable(),
  /** In time order, exactly as the audited query returned them. Empty means no readings. */
  points: z.array(pointSpec).readonly(),
});

/** chart.compare: two panels on one value axis, or both windows on one axis by day. */
export const COMPARE_LAYOUTS = ["side-by-side", "overlaid"] as const;

export type CompareLayout = (typeof COMPARE_LAYOUTS)[number];

const compareWindowSpec = z.object({
  start: z.string(),
  end: z.string(),
  n: z.number().int().nonnegative(),
  /** Null when the window has no readings; never 0. */
  mean: z.number().nullable(),
  points: z.array(pointSpec).readonly(),
});

export const compareSpecSchema = z.object({
  measure: z.string(),
  label: z.string(),
  unit: z.string().nullable(),
  subject: z.string().nullable(),
  layout: z.enum(COMPARE_LAYOUTS),
  /** The earlier window, `compare_with` (compare_windows' window_a). */
  before: compareWindowSpec,
  /** The window asked about (compare_windows' window_b). */
  after: compareWindowSpec,
  /** after.mean − before.mean; null when either is. */
  meanDelta: z.number().nullable(),
});

export const RANGE_POSITIONS = ["below", "within", "above"] as const;

export const TREND_DIRECTIONS = ["up", "down", "level"] as const;

export const biomarkerCardSpecSchema = z.object({
  measure: z.string(),
  label: z.string(),
  subject: z.string(),
  window: windowSpec,
  /** The newest reading in the window. */
  value: z.number(),
  unit: z.string(),
  at: z.string(),
  /** Rows read in the window. */
  n: z.number().int().positive(),
  /** The Anchor v3 published range; null when it depends on a fact the record lacks. */
  range: z
    .object({
      low: z.number().nullable(),
      high: z.number().nullable(),
      unit: z.string(),
      population: z.string(),
      source: z.literal("Anchor v3"),
    })
    .nullable(),
  position: z.enum(RANGE_POSITIONS).nullable(),
  dependsOn: z.array(z.enum(["sex", "age", "timing"])).readonly(),
  trend: z.object({
    n: z.number().int().nonnegative(),
    /** Null below three readings or two days, where `trend` fits no slope. */
    direction: z.enum(TREND_DIRECTIONS).nullable(),
    slopePerDay: z.number().nullable(),
    slopeUnit: z.string().nullable(),
  }),
});

export const TABLE_COLUMN_FORMATS = ["date", "number", "text"] as const;

const cellSpec = z.union([z.string(), z.number(), z.null()]);

export const tableSpecSchema = z.object({
  measure: z.string(),
  label: z.string(),
  unit: z.string().nullable(),
  window: windowSpec,
  subject: z.string().nullable(),
  columns: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        format: z.enum(TABLE_COLUMN_FORMATS),
      }),
    )
    .readonly(),
  /** At most `TABLE_ROW_CAP`, in the order the query returned them. */
  rows: z.array(z.record(z.string(), cellSpec)).readonly(),
  /** Rows the query returned; more than `rows.length` when the table is cut. */
  total: z.number().int().nonnegative(),
});

/** Which body a `twin.body` view starts on: the Demo body, or Self (its scan where there is one). */
export const TWIN_BODIES = ["demo", "self"] as const;

/**
 * twin.body: the twin focused on an organ or system, with the range position
 * of each mapped organ under it (`packages/biomarkers/focus-state.ts`). No
 * value is stored, only positions and the marker that set them.
 */
export const twinBodySpecSchema = z.object({
  focus: z.enum(TWIN_FOCUS_IDS),
  label: z.string(),
  body: z.enum(TWIN_BODIES),
  /** The synthetic subject whose labs were read; null when none was. */
  subject: z.string().nullable(),
  /** The window read; null when none was asked for and each marker's latest reading was used. */
  window: windowSpec.nullable(),
  /** No measure, so no unit; kept so every spec answers `unit`. */
  unit: z.null(),
  organs: z
    .array(
      z.object({
        organ: z.string(),
        label: z.string(),
        position: z.enum(RANGE_POSITIONS),
        marker: z.string(),
        loinc: z.string(),
      }),
    )
    .readonly(),
  /** Rows read (in the window, if any); 0 when no subject or no mapped marker. */
  n: z.number().int().nonnegative(),
});

/**
 * map.choropleth: where a population estimate is drawn. `world` shows every
 * country, `region` the countries with a value and their neighbours,
 * `country` one country's states or provinces.
 */
export const MAP_LEVELS = ["world", "region", "country"] as const;

export type MapLevel = (typeof MAP_LEVELS)[number];

const ISO3 = /^[A-Z]{3}$/;

/**
 * map.choropleth: one population estimate (one measure, cause, year, sex
 * and age) by place, exactly as the turn's estimate lookups returned it.
 * Places are matched to Natural Earth boundaries by code or name on the
 * server; a place that matched none is listed, never dropped quietly.
 */
export const choroplethSpecSchema = z.object({
  level: z.enum(MAP_LEVELS),
  /** ISO 3166-1 alpha-3 of the country whose states are drawn; null for world and region. */
  country: z.string().regex(ISO3).nullable(),
  /** The estimate's measure, such as `prevalence`. */
  measure: z.string(),
  label: z.string(),
  unit: z.string().nullable(),
  /** Where the estimates come from, such as `IHME GBD 2021`. */
  source: z.string(),
  /** Population estimates are about no one. */
  subject: z.null(),
  regions: z
    .array(
      z.object({
        code: z.string(),
        name: z.string(),
        /** The location as the estimate named it. */
        location: z.string(),
        value: z.number(),
        lower: z.number().nullable(),
        upper: z.number().nullable(),
      }),
    )
    .readonly(),
  /** Locations of the estimate that match no boundary at this level. */
  unmatched: z.array(z.string()).readonly(),
  /** Estimate rows read; regions plus unmatched. */
  n: z.number().int().nonnegative(),
});

const sources = z.array(z.string()).min(1).readonly();

const viewOf = <K extends string, S extends z.ZodType>(kind: K, spec: S) =>
  z.object({
    id: z.string(),
    kind: z.literal(kind),
    title: z.string(),
    spec,
    /** Audit `seq` of every query the view came from. */
    sourceAuditIds: sources,
  });

export const chatViewSchema = z.discriminatedUnion("kind", [
  viewOf("chart.timeseries", timeseriesSpecSchema),
  viewOf("chart.compare", compareSpecSchema),
  viewOf("biomarker.card", biomarkerCardSpecSchema),
  viewOf("table", tableSpecSchema),
  viewOf("twin.body", twinBodySpecSchema),
  viewOf("map.choropleth", choroplethSpecSchema),
]);

/**
 * WHAT: Google Health type enumerations and query-window helpers.
 * NOT:  Must not map to FHIR; mappers own Observation coding.
GOVERNED BY: DECISIONS.md#d5
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import { ConnectorError } from '@open-twin/fhir-core';
import type { health_v4 } from 'googleapis';

export const DAILY_TYPES = [
  'daily-heart-rate-variability',
  'daily-heart-rate-zones',
  'daily-oxygen-saturation',
  'daily-respiratory-rate',
  'daily-resting-heart-rate',
  'daily-sleep-temperature-derivations',
  'daily-vo2-max'
] as const;

export type DailyType = (typeof DAILY_TYPES)[number];
export type DailyTypes = DailyType[];

export interface DailyReturnType {
  [key: string]: health_v4.Schema$ListDataPointsResponse;
}

export const SAMPLE_TYPES = [
  'blood-glucose',
  'body-fat',
  'core-body-temperature',
  'heart-rate',
  'heart-rate-variability',
  'height',
  'oxygen-saturation',
  'respiratory-rate-sleep-summary',
  'run-vo2-max',
  'vo2-max',
  'weight'
] as const;

export type SampleType = (typeof SAMPLE_TYPES)[number];
export type SampleTypes = SampleType[];

export interface SampleReturnType {
  [key: string]: health_v4.Schema$ListDataPointsResponse;
}

/**
 * `total-calories` and `calories-in-heart-rate-zone` used to appear here. Neither is a
 * `DataPoint` member in any form: both exist only on `RollupDataPoint` and
 * `DailyRollupDataPoint`, i.e. they are computed by `dataPoints:rollUp`, not listable
 * by `dataPoints.list`. Requesting them did not merely fail to map — it produced a
 * malformed request that the API rejects with `INVALID_PARENT_DATA_TYPE_COLLECTION`.
 * If those metrics are wanted they need a separate rollup path with its own mapper.
 *
 * `activity-level` stays here despite the discovery document labelling it a daily type:
 * `Schema$ActivityLevel` carries `interval` and has no `date` field, so a `.date` filter
 * would name a field the record does not have.
 */
export const INTERVAL_TYPES = [
  'active-energy-burned',
  'active-minutes',
  'active-zone-minutes',
  'activity-level',
  'altitude',
  'basal-energy-burned',
  'distance',
  'floors',
  'sedentary-period',
  'steps',
  'swim-lengths-data',
  'time-in-heart-rate-zone'
] as const;

export type IntervalType = (typeof INTERVAL_TYPES)[number];
export type IntervalTypes = IntervalType[];

/**
 * `nutrition-log` belongs here, not in SAMPLE_TYPES. The discovery document calls it a
 * "session data type collection" and `Schema$NutritionLog` carries a
 * `SessionTimeInterval` and no `sample_time`, so the sample filter named a field that
 * does not exist on the record.
 */
export const SESSION_TYPES = [
  'electrocardiogram',
  'exercise',
  'hydration-log',
  'irregular-rhythm-notification',
  'nutrition-log',
  'sleep'
] as const;

export type SessionType = (typeof SESSION_TYPES)[number];
export type SessionTypes = SessionType[];

export type AllType = DailyType | SampleType | IntervalType | SessionType;
export type AllTypes = AllType[];

export const ALL_TYPES: readonly AllType[] = [
  ...DAILY_TYPES,
  ...SAMPLE_TYPES,
  ...INTERVAL_TYPES,
  ...SESSION_TYPES
] as const;

export function getFilterTypeCategory(type: AllType): 'daily' | 'sample_time' | 'interval' | 'session' {
  if ((DAILY_TYPES as readonly string[]).includes(type)) return 'daily';
  if ((SAMPLE_TYPES as readonly string[]).includes(type)) return 'sample_time';
  if ((INTERVAL_TYPES as readonly string[]).includes(type)) return 'interval';
  if ((SESSION_TYPES as readonly string[]).includes(type)) return 'session';

  throw new ConnectorError(`Unknown Google Health data type "${type}"`, {
    code: 'unsupported',
    connector: 'google-health',
    operation: 'buildTypeFilter'
  });
}

export const DEFAULT_START = '1970-01-01T00:00:00Z';

/**
 * Decision D7: the query window is half-open `[start, end)` and computed **once** per
 * sync. `end` used to default to `new Date().toISOString()` inside `buildTypeFilter`,
 * which runs per data type, so a single sync had a different upper bound for each type.
 */
export interface QueryWindow {
  /** RFC 3339 instant, inclusive. */
  start: string;
  /** RFC 3339 instant, exclusive. */
  end: string;
  /** IANA zone the subject's civil dates are computed in. */
  timeZone: string;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/;

function assertIso(label: string, value: string): void {
  // The value is interpolated into an AIP-160 filter expression between double quotes.
  // Validating it here is what stops a quote in a caller-supplied date from closing the
  // literal and injecting arbitrary filter syntax, and it also turns a malformed date
  // into an error rather than a filter that matches nothing.
  if (!ISO_INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ConnectorError(`${label} must be an ISO 8601 date or date-time`, {
      code: 'validation',
      connector: 'google-health',
      operation: 'resolveWindow'
    });
  }
}

export function resolveWindow(
  startDate?: string,
  endDate?: string,
  timeZone = 'UTC',
  now: Date = new Date()
): QueryWindow {
  const start = startDate ?? DEFAULT_START;
  const end = endDate ?? now.toISOString();

  assertIso('start_date', start);
  assertIso('end_date', end);

  if (Date.parse(start) > Date.parse(end)) {
    throw new ConnectorError('start_date must not be after end_date', {
      code: 'validation',
      connector: 'google-health',
      operation: 'resolveWindow'
    });
  }

  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  } catch {
    throw new ConnectorError(`Unknown IANA time zone "${timeZone}"`, {
      code: 'validation',
      connector: 'google-health',
      operation: 'resolveWindow'
    });
  }

  return { start, end, timeZone };
}

/**
 * The civil date an instant falls on **in the subject's zone**.
 *
 * `value.slice(0, 10)` on a UTC instant is not this. At UTC+13, local Sunday 01:00 is
 * `2026-07-25T12:00:00Z`, so the slice yields the 25th and the exclusive upper bound
 * then drops both the 25th and the current local day.
 */
export function civilDate(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(instant));
}

function civilTimeOfDay(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(instant));
}

function nextCivilDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/**
 * A civil-date filter is a coarsening of an instant window, so its exclusive upper
 * bound must be the *next* civil day whenever the instant end falls strictly inside a
 * civil day. Otherwise a sync that runs at 14:00 silently excludes everything recorded
 * that day — the failure that made "no data today" indistinguishable from "no data".
 */
export function civilUpperBound(window: QueryWindow): string {
  const date = civilDate(window.end, window.timeZone);
  const timeOfDay = civilTimeOfDay(window.end, window.timeZone);
  return timeOfDay === '00:00:00' ? date : nextCivilDate(date);
}

export function buildTypeFilter(type: AllType, window: QueryWindow): string {
  const category = getFilterTypeCategory(type);
  const filterPrefix = type.replace(/-/g, '_');
  const civilStart = civilDate(window.start, window.timeZone);
  const civilEnd = civilUpperBound(window);

  switch (category) {
    case 'daily': {
      const field = `${filterPrefix}.date`;
      return `${field} >= "${civilStart}" AND ${field} < "${civilEnd}"`;
    }
    case 'sample_time': {
      const field = `${filterPrefix}.sample_time.physical_time`;
      return `${field} >= "${window.start}" AND ${field} < "${window.end}"`;
    }
    case 'interval': {
      const field = `${filterPrefix}.interval.start_time`;
      return `${field} >= "${window.start}" AND ${field} < "${window.end}"`;
    }
    case 'session': {
      if (type === 'sleep') {
        return `sleep.interval.end_time >= "${window.start}" AND sleep.interval.end_time < "${window.end}"`;
      }

      if (type === 'electrocardiogram') {
        // ECG supports `>=` only. Adding the `<` upper bound made the request 400 with
        // INVALID_DATA_POINT_FILTER_RESTRICTION_COMPARATOR, so no ECG ever came back.
        return `electrocardiogram.interval.start_time >= "${window.start}"`;
      }

      const field = `${filterPrefix}.interval.civil_start_time`;
      return `${field} >= "${civilStart}" AND ${field} < "${civilEnd}"`;
    }
  }
}

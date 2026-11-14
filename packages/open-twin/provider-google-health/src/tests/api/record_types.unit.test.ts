import { describe, expect, it } from 'vitest';
import {
  ALL_TYPES,
  buildTypeFilter,
  civilDate,
  getFilterTypeCategory,
  INTERVAL_TYPES,
  resolveWindow,
  SAMPLE_TYPES,
  SESSION_TYPES
} from '../../api/record_types';

const UTC_WINDOW = resolveWindow('2026-07-01T00:00:00Z', '2026-07-08T00:00:00Z');

describe('the declared type lists', () => {
  it('no longer declares the two rollup-only types', () => {
    // Neither is a DataPoint member in any form: both live only on RollupDataPoint, so
    // requesting them produced a malformed request rather than an unmapped result.
    expect(ALL_TYPES).not.toContain('total-calories');
    expect(ALL_TYPES).not.toContain('calories-in-heart-rate-zone');
  });

  it('declares basal-energy-burned, which is a real DataPoint member', () => {
    expect(INTERVAL_TYPES).toContain('basal-energy-burned');
  });

  it('classifies nutrition-log as a session type, matching the record it carries', () => {
    // Schema$NutritionLog carries a SessionTimeInterval and no sample_time, so the old
    // sample filter named a field that does not exist on the record.
    expect(SESSION_TYPES).toContain('nutrition-log');
    expect(SAMPLE_TYPES).not.toContain('nutrition-log');
    expect(getFilterTypeCategory('nutrition-log')).toBe('session');
  });

  it('rejects a type it does not know', () => {
    // @ts-expect-error - exercising the runtime boundary with an undeclared type
    expect(() => getFilterTypeCategory('telepathy')).toThrow(/Unknown Google Health data type/);
  });
});

describe('resolveWindow', () => {
  it('resolves the window once, so every type in one sync shares an upper bound', () => {
    const now = new Date('2026-07-26T14:00:00Z');
    const window = resolveWindow(undefined, undefined, 'UTC', now);

    expect(window.start).toBe('1970-01-01T00:00:00Z');
    expect(window.end).toBe('2026-07-26T14:00:00.000Z');
  });

  it('rejects a date that would inject filter syntax', () => {
    // The value is interpolated between double quotes into an AIP-160 filter.
    expect(() => resolveWindow('2026-07-01" OR steps.interval.start_time >= "1970-01-01')).toThrow(
      /must be an ISO 8601 date/
    );
  });

  it('rejects a malformed date rather than silently matching nothing', () => {
    expect(() => resolveWindow('2026-13-45')).toThrow(/must be an ISO 8601 date/);
    expect(() => resolveWindow('01.07.2026')).toThrow(/must be an ISO 8601 date/);
  });

  it('rejects an inverted window', () => {
    expect(() => resolveWindow('2026-07-08T00:00:00Z', '2026-07-01T00:00:00Z')).toThrow(/must not be after/);
  });

  it('rejects an unknown time zone', () => {
    expect(() => resolveWindow(undefined, undefined, 'Mars/Olympus')).toThrow(/Unknown IANA time zone/);
  });
});

describe('civil dates', () => {
  it("derives the civil date in the subject's zone, not by slicing a UTC instant", () => {
    // At UTC+13 the local Sunday 01:00 is 2026-07-25T12:00:00Z, so slicing the first
    // ten characters yields the previous civil day.
    expect(civilDate('2026-07-25T12:00:00Z', 'Pacific/Auckland')).toBe('2026-07-26');
    expect(civilDate('2026-07-25T12:00:00Z', 'UTC')).toBe('2026-07-25');
  });

  it('includes the current civil day when the window ends part-way through it', () => {
    const window = resolveWindow('2026-07-01T00:00:00Z', '2026-07-26T14:00:00Z', 'UTC');

    // A civil filter is a coarsening of an instant window, so the exclusive upper bound
    // has to be the next civil day or everything recorded today is dropped.
    expect(buildTypeFilter('daily-resting-heart-rate', window)).toBe(
      'daily_resting_heart_rate.date >= "2026-07-01" AND daily_resting_heart_rate.date < "2026-07-27"'
    );
  });

  it('keeps a midnight upper bound exclusive, so the window stays half-open', () => {
    expect(buildTypeFilter('daily-resting-heart-rate', UTC_WINDOW)).toBe(
      'daily_resting_heart_rate.date >= "2026-07-01" AND daily_resting_heart_rate.date < "2026-07-08"'
    );
  });
});

describe('buildTypeFilter', () => {
  it('uses the sample physical-time field for sample types', () => {
    expect(buildTypeFilter('heart-rate', UTC_WINDOW)).toBe(
      'heart_rate.sample_time.physical_time >= "2026-07-01T00:00:00Z" AND heart_rate.sample_time.physical_time < "2026-07-08T00:00:00Z"'
    );
  });

  it('uses the interval start-time field for every interval type', () => {
    for (const type of INTERVAL_TYPES) {
      const prefix = type.replace(/-/g, '_');
      expect(buildTypeFilter(type, UTC_WINDOW)).toBe(
        `${prefix}.interval.start_time >= "2026-07-01T00:00:00Z" AND ${prefix}.interval.start_time < "2026-07-08T00:00:00Z"`
      );
    }
  });

  it('uses the civil start time for session types other than sleep and ECG', () => {
    expect(buildTypeFilter('nutrition-log', UTC_WINDOW)).toBe(
      'nutrition_log.interval.civil_start_time >= "2026-07-01" AND nutrition_log.interval.civil_start_time < "2026-07-08"'
    );
    expect(buildTypeFilter('exercise', UTC_WINDOW)).toBe(
      'exercise.interval.civil_start_time >= "2026-07-01" AND exercise.interval.civil_start_time < "2026-07-08"'
    );
  });

  it('filters sleep on the interval end time', () => {
    expect(buildTypeFilter('sleep', UTC_WINDOW)).toBe(
      'sleep.interval.end_time >= "2026-07-01T00:00:00Z" AND sleep.interval.end_time < "2026-07-08T00:00:00Z"'
    );
  });

  it('emits only >= for ECG, which is the only comparator that type supports', () => {
    // The `<` upper bound made the request 400 with
    // INVALID_DATA_POINT_FILTER_RESTRICTION_COMPARATOR, so no ECG ever came back.
    const filter = buildTypeFilter('electrocardiogram', UTC_WINDOW);

    expect(filter).toBe('electrocardiogram.interval.start_time >= "2026-07-01T00:00:00Z"');
    expect(filter).not.toContain('<');
    expect(filter).not.toContain('AND');
  });

  it('builds a filter for every declared type without throwing', () => {
    for (const type of ALL_TYPES) {
      expect(buildTypeFilter(type, UTC_WINDOW)).toContain('>=');
    }
  });
});

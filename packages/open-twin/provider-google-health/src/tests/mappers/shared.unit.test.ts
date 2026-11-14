import { describe, expect, it } from 'vitest';
import {
  applyOffset,
  gramsToKilograms,
  intervalToPeriod,
  loincQuantity,
  millimetresToCentimetres,
  millimetresToMetres,
  periodMinutes,
  sampleTimeToDateTime,
  toNumber
} from '../../fhir/mappers/shared';

describe('toNumber', () => {
  it('parses the JSON strings Google uses for int64 fields', () => {
    expect(toNumber('72')).toBe(72);
    expect(toNumber('44286')).toBe(44286);
    expect(toNumber(0)).toBe(0);
    expect(toNumber('0')).toBe(0);
  });

  it('returns undefined for an empty or whitespace string rather than fabricating a zero', () => {
    // Number('') is 0 and Number.isFinite(0) is true, so an empty beatsPerMinute used
    // to publish a heart rate of zero indistinguishable from a real reading.
    expect(toNumber('')).toBeUndefined();
    expect(toNumber('   ')).toBeUndefined();
    expect(toNumber('\n')).toBeUndefined();
  });

  it('returns undefined for absent and unparseable values', () => {
    expect(toNumber(undefined)).toBeUndefined();
    expect(toNumber(null)).toBeUndefined();
    expect(toNumber('abc')).toBeUndefined();
    expect(toNumber(Number.NaN)).toBeUndefined();
    expect(toNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe('applyOffset', () => {
  it("re-renders a UTC instant in the subject's own offset", () => {
    expect(applyOffset('2026-07-07T05:40:29.354Z', '7200s')).toBe('2026-07-07T07:40:29.354+02:00');
  });

  it('handles negative offsets', () => {
    expect(applyOffset('2026-07-07T05:40:29.000Z', '-14400s')).toBe('2026-07-07T01:40:29.000-04:00');
  });

  it('keeps the raw instant when no offset is supplied', () => {
    expect(applyOffset('2026-07-07T05:40:29.354Z')).toBe('2026-07-07T05:40:29.354Z');
  });

  it('keeps the raw instant when the offset is not a whole number of minutes', () => {
    expect(applyOffset('2026-07-07T05:40:29.354Z', '90s')).toBe('2026-07-07T05:40:29.354Z');
  });

  it('returns undefined when there is no instant', () => {
    expect(applyOffset(undefined, '7200s')).toBeUndefined();
    expect(applyOffset(null, '7200s')).toBeUndefined();
  });
});

describe('sampleTimeToDateTime', () => {
  it('carries the UTC offset the API supplied', () => {
    expect(sampleTimeToDateTime({ physicalTime: '2026-07-07T05:40:29.354Z', utcOffset: '7200s' })).toBe(
      '2026-07-07T07:40:29.354+02:00'
    );
  });
});

describe('intervalToPeriod', () => {
  it('applies the start and end offsets independently', () => {
    expect(
      intervalToPeriod({
        startTime: '2026-07-07T07:51:29Z',
        startUtcOffset: '7200s',
        endTime: '2026-07-07T07:52:29Z',
        endUtcOffset: '7200s'
      })
    ).toEqual({ start: '2026-07-07T09:51:29.000+02:00', end: '2026-07-07T09:52:29.000+02:00' });
  });

  it('returns undefined when the interval carries no time at all', () => {
    expect(intervalToPeriod({})).toBeUndefined();
    expect(intervalToPeriod(undefined)).toBeUndefined();
  });
});

describe('periodMinutes', () => {
  it('measures the elapsed minutes across a period', () => {
    expect(periodMinutes({ start: '2026-07-07T07:00:00Z', end: '2026-07-07T07:30:00Z' })).toBe(30);
  });

  it('returns undefined when either bound is missing', () => {
    expect(periodMinutes({ start: '2026-07-07T07:00:00Z' })).toBeUndefined();
    expect(periodMinutes(undefined)).toBeUndefined();
  });
});

describe('unit conversions', () => {
  it('converts the millimetres Google sends into metres, centimetres and kilograms', () => {
    expect(millimetresToMetres('44286')).toBe(44.286);
    expect(millimetresToCentimetres('1750')).toBe(175);
    expect(gramsToKilograms(86000)).toBe(86);
  });

  it('propagates absence rather than converting a missing value to zero', () => {
    expect(millimetresToMetres(undefined)).toBeUndefined();
    expect(millimetresToCentimetres('')).toBeUndefined();
    expect(gramsToKilograms(null)).toBeUndefined();
  });
});

describe('loincQuantity', () => {
  it('takes the unit from the shared LOINC table rather than from the call site', () => {
    expect(loincQuantity('8302-2', 175)).toEqual({
      value: 175,
      unit: 'centimeter',
      system: 'http://unitsofmeasure.org',
      code: 'cm'
    });
  });

  it('refuses to emit a LOINC code with no registered unit', () => {
    expect(() => loincQuantity('99999-9', 1)).toThrow(/No shared unit is registered/);
  });
});

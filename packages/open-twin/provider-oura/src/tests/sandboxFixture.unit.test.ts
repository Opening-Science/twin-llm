import { describe, expect, it } from 'vitest';
import { LIST_SCHEMAS } from '../utils/typeUtils';
import capture from './fixtures/sandbox-capture.json';

/**
 * The recorded Oura sandbox capture, checked against this connector's own schemas.
 *
 * Every other test in this package runs on literals written while writing the
 * mapper, which cannot contradict the mapper: a fixture authored from the same
 * understanding as the code agrees with it whether or not that understanding is
 * right. This one was produced by Oura, so it can disagree with us — and where it
 * does, we are wrong.
 *
 * See fixtures/PROVENANCE.md for what the capture is and what it is not.
 */
const captured = capture as Record<string, { data?: unknown[]; next_token?: string | null }>;

describe('the recorded sandbox capture', () => {
  it('covers every scope the sandbox serves', () => {
    // personal_info is absent on purpose: the sandbox returns 404 for it, which is
    // itself a defect in `getOuraDataSandbox` — it sends sandbox: true for every
    // requested type, so any sandbox call including personal_info fails.
    expect(Object.keys(captured).sort()).toEqual(
      [
        'daily_activity',
        'daily_cardiovascular_age',
        'daily_readiness',
        'daily_resilience',
        'daily_spo2',
        'daily_stress',
        'heartrate',
        'rest_mode_period',
        'ring_configuration',
        'session',
        'sleep',
        'vO2_max',
        'workout'
      ].sort()
    );
  });

  const listScopes = Object.keys(captured).filter((scope) => scope in LIST_SCHEMAS);

  it.each(listScopes)('parses %s against the connector schema', (scope) => {
    // If Oura changes a field, this fails and names the field — which is the whole
    // point of recording real responses rather than inventing them.
    const schema = LIST_SCHEMAS[scope as keyof typeof LIST_SCHEMAS];
    const result = schema.safeParse(captured[scope]);
    if (!result.success) {
      throw new Error(
        `${scope} no longer matches its schema: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`
      );
    }
    expect(result.success).toBe(true);
  });

  it('carries the durations in seconds that defect O3 was about', () => {
    // Not decoration. This is the evidence that Oura sends seconds, and it is why
    // the sleep mapper converts rather than relabels: a total sleep duration of
    // 2370 inside a 3000 time-in-bed is 39.5 minutes in 50, not 2370 minutes.
    const first = (captured.sleep?.data?.[0] ?? {}) as Record<string, number>;
    expect(first.total_sleep_duration).toBeLessThan(first.time_in_bed as number);
    expect(first.total_sleep_duration).toBeGreaterThan(600); // seconds, not minutes
  });

  it('contains no personal data', () => {
    // Asserted, not assumed. An earlier scan reported 266 "phone numbers" that were
    // all ISO dates caught by a careless pattern, so the pattern is written to be
    // one a date cannot satisfy.
    const blob = JSON.stringify(captured);
    expect(blob).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(blob).not.toMatch(/(?<![\d-])(?:\+\d{1,3}[ -]?)?\(?\d{3}\)?[ -]\d{3}[ -]\d{4}(?![\d-])/);
    expect(blob).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/);
  });
});

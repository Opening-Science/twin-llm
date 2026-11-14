import { describe, expect, it } from 'vitest';
import { ConnectorError, fromHttpStatus, parseRetryAfter, toOperationOutcome } from '../errors';

const PROBAND = JSON.stringify({
  name: 'Erika Mustermann',
  date_of_birth: '1984-03-02',
  email: 'erika@example.org'
});

describe('ConnectorError', () => {
  it('classifies failures so a caller knows what to do', () => {
    expect(fromHttpStatus(401, { connector: 'oura' }).code).toBe('auth');
    expect(fromHttpStatus(404, { connector: 'oura' }).code).toBe('not_found');
    expect(fromHttpStatus(429, { connector: 'oura' }).code).toBe('rate_limit');
    expect(fromHttpStatus(500, { connector: 'oura' }).code).toBe('server');
    expect(fromHttpStatus(422, { connector: 'oura' }).code).toBe('validation');
  });

  it('marks throttling and server errors retryable, and auth errors not', () => {
    expect(fromHttpStatus(429, { connector: 'oura' }).retryable).toBe(true);
    expect(fromHttpStatus(503, { connector: 'oura' }).retryable).toBe(true);
    expect(fromHttpStatus(401, { connector: 'oura' }).retryable).toBe(false);
    expect(fromHttpStatus(400, { connector: 'oura' }).retryable).toBe(false);
  });

  it('reports the real HTTP status instead of undefined', () => {
    // The defect: errorResponseHandler declared (response: Response) but was handed
    // the parsed JSON body, so status was always undefined and every OAuth failure
    // reported 'Unexpected error (undefined): undefined'.
    const error = fromHttpStatus(401, { connector: 'oura', operation: 'POST oauth/token' });
    expect(error.status).toBe(401);
    expect(error.toString()).toContain('HTTP 401');
    expect(error.toString()).not.toContain('undefined');
  });

  it('never carries a response body', () => {
    // The defect: raw bodies were interpolated into thrown messages at fourteen
    // sites in the VITRONIC client alone, three of which leak proband records.
    const error = new ConnectorError('The upstream service rejected the request', {
      code: 'validation',
      connector: 'vitronic',
      operation: 'GET probands/42',
      status: 400,
      cause: new Error('parse failed')
    });
    const rendered = `${error.message} ${error.toString()} ${error.stack ?? ''}`;
    expect(rendered).not.toContain('Mustermann');
    expect(rendered).not.toContain('erika@example.org');
    expect(rendered).not.toContain(PROBAND);
    expect(rendered).toContain('GET probands/42');
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-07-26T12:00:00Z');

  it('reads delta-seconds', () => {
    expect(parseRetryAfter('30', now)).toBe(30);
  });

  it('reads an HTTP-date, which RFC 7231 also permits', () => {
    expect(parseRetryAfter('Sun, 26 Jul 2026 12:00:30 GMT', now)).toBe(30);
  });

  it('never returns a negative wait for a date already past', () => {
    expect(parseRetryAfter('Sun, 26 Jul 2026 11:59:00 GMT', now)).toBe(0);
  });

  it('returns undefined when the header is absent or unparseable', () => {
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter('soon', now)).toBeUndefined();
  });
});

describe('toOperationOutcome', () => {
  it('is undefined when nothing failed', () => {
    expect(toOperationOutcome([])).toBeUndefined();
  });

  it('reports a rate limit as a warning, so partial results still stand', () => {
    // Decision D6: one failing data type must not discard the other four.
    const outcome = toOperationOutcome([fromHttpStatus(429, { connector: 'oura', operation: 'GET sleep' })]);
    expect(outcome?.issue[0]?.severity).toBe('warning');
    expect(outcome?.issue[0]?.code).toBe('throttled');
  });

  it('does not leak a payload into diagnostics', () => {
    const outcome = toOperationOutcome([
      new ConnectorError('The upstream service rejected the request', {
        code: 'validation',
        connector: 'vitronic',
        operation: 'GET probands/42',
        cause: new Error(PROBAND)
      })
    ]);
    expect(outcome?.issue[0]?.diagnostics).not.toContain('Mustermann');
  });
});

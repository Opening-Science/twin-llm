import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OuraRingAppConfig } from '../../config/config';
import { getOuraData } from '../../index';
import { TokenHandler } from '../../utils/tokenUtils';

describe('getOuraData (integration)', () => {
  const appConfig: OuraRingAppConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'https://example.com/callback'
  };

  const authorizationCode = 'test-authorization-code';

  let tokenHandler: TokenHandler;

  const heartRateResponse = {
    data: [
      {
        timestamp: '2026-06-20T08:00:00+00:00',
        timestamp_unix: 1781856000000,
        bpm: 60,
        source: 'awake'
      }
    ],
    next_token: null
  };

  const personalResponse = {
    id: 'user-123',
    age: 30,
    weight: 70,
    height: 1.8,
    biological_sex: 'male',
    email: 'user@example.com'
  };

  const okJson = (body: unknown): Response =>
    ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => body
    }) as unknown as Response;

  const mockFetchByType = (routes: Record<string, unknown>) => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      const match = Object.keys(routes).find((type) => url.includes(`/usercollection/${type}`));
      if (!match) {
        return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
      }
      return Promise.resolve(okJson(routes[match]));
    });
  };

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    tokenHandler = new TokenHandler(appConfig, authorizationCode);

    vi.spyOn(tokenHandler, 'getAccessToken').mockResolvedValue('mock-access-token');
  });

  it('fetches and parses a single list-based type (heartrate)', async () => {
    mockFetchByType({ heartrate: heartRateResponse });

    const result = await getOuraData(
      { types: ['heartrate'], start_date: '2026-06-20', end_date: '2026-06-29' },
      tokenHandler
    );

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://api.ouraring.com/v2/usercollection/heartrate?'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer mock-access-token' })
      })
    );

    expect(result.data).toHaveLength(1);
    const [heartRate] = result.data;
    expect(heartRate.type).toBe('heartrate');
    expect(heartRate.type === 'heartrate' && heartRate.data.data[0].bpm).toBe(60);
    expect(result.issues).toBeUndefined();
  });

  it('never forwards the requested type list as a query parameter', async () => {
    mockFetchByType({ heartrate: heartRateResponse });

    await getOuraData({ types: ['heartrate'], start_date: '2026-06-20' }, tokenHandler);

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    // `buildQueryString` was declared `Omit<RequestParams,'types'>` and called with
    // the whole request, so every URL carried `types=...`. Oura ignores unknown
    // parameters, which is why no test ever noticed.
    expect(url).not.toContain('types=');
  });

  it('sends heartrate the datetime parameters it actually accepts', async () => {
    mockFetchByType({ heartrate: heartRateResponse });

    await getOuraData({ types: ['heartrate'], start_date: '2026-06-20', end_date: '2026-06-29' }, tokenHandler);

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    // The heartrate endpoint takes start_datetime/end_datetime only. Given
    // start_date it returns 200 and silently ignores the window.
    expect(url).toContain('start_datetime=');
    expect(url).toContain('end_datetime=');
    expect(url).not.toContain('start_date=');
  });

  it('covers the whole of the final requested day', async () => {
    mockFetchByType({ heartrate: heartRateResponse });

    await getOuraData({ types: ['heartrate'], start_date: '2026-06-20', end_date: '2026-06-29' }, tokenHandler);

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    // A bare date carries no time, so widening the end of the window to the end of
    // that day is the difference between asking for ten days and asking for nine
    // days and one instant. Collapsing it to T00:00:00 dropped roughly 24h of
    // samples, and Oura returns 200 either way so nothing surfaced the loss.
    expect(decodeURIComponent(url)).toContain('start_datetime=2026-06-20T00:00:00+00:00');
    expect(decodeURIComponent(url)).toContain('end_datetime=2026-06-29T23:59:59+00:00');
  });

  it("uses the wearer's offset rather than assuming UTC", async () => {
    mockFetchByType({ heartrate: heartRateResponse });

    await getOuraData(
      { types: ['heartrate'], start_date: '2026-06-20', end_date: '2026-06-20', utc_offset: '+03:00' },
      tokenHandler
    );

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    // Hardcoding +00:00 is the same assumption D7 forbids in the mappers: it
    // shifts a wearer at +03:00 by three hours in both directions.
    expect(decodeURIComponent(url)).toContain('start_datetime=2026-06-20T00:00:00+03:00');
    expect(decodeURIComponent(url)).toContain('end_datetime=2026-06-20T23:59:59+03:00');
  });

  it('sends personal_info no time parameters at all', async () => {
    mockFetchByType({ personal_info: personalResponse });

    await getOuraData({ types: ['personal_info'], start_date: '2026-06-20' }, tokenHandler);

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(url).toBe('https://api.ouraring.com/v2/usercollection/personal_info');
  });

  it('fetches and parses a non-list type (personal_info)', async () => {
    mockFetchByType({ personal_info: personalResponse });

    const result = await getOuraData({ types: ['personal_info'] }, tokenHandler);

    expect(result.data).toHaveLength(1);
    const [personal] = result.data;
    expect(personal.type).toBe('personal_info');
    expect(personal.data).toEqual(personalResponse);
  });

  it('resolves multiple requested types preserving order', async () => {
    mockFetchByType({
      heartrate: heartRateResponse,
      personal_info: personalResponse
    });

    const result = await getOuraData({ types: ['heartrate', 'personal_info'] }, tokenHandler);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(result.data.map((item) => item.type)).toEqual(['heartrate', 'personal_info']);
  });

  it('requests one access token for the whole fan-out, not one per type', async () => {
    mockFetchByType({ heartrate: heartRateResponse, personal_info: personalResponse });

    await getOuraData({ types: ['heartrate', 'personal_info'] }, tokenHandler);

    // Awaiting the token inside the loop meant N concurrent refreshes when it had
    // expired, each overwriting the last.
    expect(tokenHandler.getAccessToken).toHaveBeenCalledTimes(1);
  });

  it('rejects a request whose type is not a supported scope', async () => {
    await expect(
      getOuraData({ types: ['not_a_real_type'] as unknown as ['heartrate'] }, tokenHandler)
    ).rejects.toThrow();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects a start_date that is not YYYY-MM-DD', async () => {
    // The schema used to demand DD.MM.YYYY and was never parsed, so a wrong date
    // reached Oura and came back as a 422 nobody could interpret.
    await expect(getOuraData({ types: ['heartrate'], start_date: '20.06.2026' }, tokenHandler)).rejects.toThrow();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects a calendar-invalid start_date', async () => {
    await expect(getOuraData({ types: ['heartrate'], start_date: '2026-99-99' }, tokenHandler)).rejects.toThrow();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('reports a non-ok status as an issue without echoing the response body', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: async () => 'user-123 token leaked in the body'
    } as unknown as Response);

    const result = await getOuraData({ types: ['heartrate'] }, tokenHandler);

    expect(result.data).toEqual([]);
    const diagnostics = result.issues?.issue?.[0]?.diagnostics ?? '';
    expect(result.issues?.issue?.[0]?.code).toBe('security');
    expect(diagnostics).toContain('HTTP 401');
    expect(diagnostics).not.toContain('user-123 token leaked in the body');
  });

  it('does not discard sibling types when one of them fails', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      if (String(input).includes('/usercollection/heartrate')) {
        return Promise.resolve({ ok: false, status: 500, headers: new Headers() } as unknown as Response);
      }
      return Promise.resolve(okJson(personalResponse));
    });

    const result = await getOuraData({ types: ['heartrate', 'personal_info'] }, tokenHandler);

    // `Promise.all` used to reject the whole call, throwing away every sibling.
    expect(result.data.map((item) => item.type)).toEqual(['personal_info']);
    expect(result.issues?.issue).toHaveLength(1);
  });

  it('retries a 429 after the interval the Retry-After header names', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let call = 0;
    vi.mocked(globalThis.fetch).mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: new Headers({ 'retry-after': '7' })
        } as unknown as Response);
      }
      return Promise.resolve(okJson(heartRateResponse));
    });

    const result = await getOuraData({ types: ['heartrate'] }, tokenHandler, { sleep });

    expect(sleep).toHaveBeenCalledWith(7000);
    expect(result.data).toHaveLength(1);
    expect(result.issues).toBeUndefined();
  });

  it('gives up on a persistent 429 and reports it as a throttling issue', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers()
    } as unknown as Response);

    const result = await getOuraData({ types: ['heartrate'] }, tokenHandler, { sleep, maxAttempts: 2 });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(result.issues?.issue?.[0]).toMatchObject({ severity: 'warning', code: 'throttled' });
  });

  it('reports a schema mismatch as an issue rather than rejecting', async () => {
    mockFetchByType({
      heartrate: { data: [{ unexpected: 'structure' }], next_token: null }
    });

    const result = await getOuraData({ types: ['heartrate'] }, tokenHandler);

    expect(result.data).toEqual([]);
    expect(result.issues?.issue?.[0]?.code).toBe('invalid');
  });

  it('records an empty window as information, not as silence', async () => {
    mockFetchByType({ heartrate: { data: [], next_token: null } });

    const result = await getOuraData({ types: ['heartrate'] }, tokenHandler);

    expect(result.issues?.issue?.[0]).toMatchObject({ severity: 'information', code: 'not-found' });
  });
});

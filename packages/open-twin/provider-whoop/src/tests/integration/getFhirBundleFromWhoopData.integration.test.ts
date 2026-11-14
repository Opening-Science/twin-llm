import { SYSTEMS } from '@open-twin/fhir-core';
import type { Observation } from 'fhir/r4';
import { describe, expect, it, vi } from 'vitest';
import type { WhoopAppConfig } from '../../config/config';
import { getFhirBundleFromWhoopData } from '../../index';
import { WHOOP_MAX_PAGES } from '../../utils/fetchWhoopData';
import { TokenHandler } from '../../utils/tokenUtils';

describe('getFhirBundleFromWhoopData (integration)', () => {
  const appConfig: WhoopAppConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'https://example.com/callback'
  };

  const tokenResponse = {
    access_token: 'access-token-test',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'refresh-token-test'
  };

  const recoveryPage = {
    records: [
      {
        sleep_id: 's1',
        created_at: '2026-06-20T08:00:00.000Z',
        score: { recovery_score: 80, resting_heart_rate: 55 }
      }
    ],
    next_token: null
  };

  const cyclePage = { records: [], next_token: null };
  const sleepPage = { records: [], next_token: null };

  it('maps fetched pages into FHIR Observations with expected codes and values', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/oauth/oauth2/token')) {
        return new Response(JSON.stringify(tokenResponse), { status: 200 });
      }
      if (url.includes('/recovery')) {
        return new Response(JSON.stringify(recoveryPage), { status: 200 });
      }
      if (url.includes('/cycle')) {
        return new Response(JSON.stringify(cyclePage), { status: 200 });
      }
      if (url.includes('/activity/sleep')) {
        return new Response(JSON.stringify(sleepPage), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const tokenHandler = new TokenHandler(appConfig, 'auth-code');
    await tokenHandler.authenticate();

    const result = await getFhirBundleFromWhoopData(
      { start: '2026-06-01T00:00:00.000Z', end: '2026-06-30T23:59:59.000Z' },
      tokenHandler,
      { subjectKey: 'user-1', timestamp: '2026-07-26T10:00:00Z' }
    );

    const observations = (result.bundle.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is Observation => r?.resourceType === 'Observation');

    const recoveryScore = observations.find((o) =>
      o.code?.coding?.some((c) => c.system === SYSTEMS.WHOOP && c.code === 'recovery-score')
    );
    expect(recoveryScore?.valueQuantity).toEqual({
      value: 80,
      unit: 'score',
      system: SYSTEMS.UCUM,
      code: '{score}'
    });

    const restingHr = observations.find((o) => o.identifier?.[0]?.value?.endsWith('-rhr'));
    expect(restingHr?.code?.coding?.[0]).toMatchObject({ system: SYSTEMS.LOINC, code: '8867-4' });
    expect(restingHr?.valueQuantity).toEqual({
      value: 55,
      unit: 'per minute',
      system: SYSTEMS.UCUM,
      code: '/min'
    });

    expect(fetchMock).toHaveBeenCalled();
  });

  it('stops pagination at MAX_PAGES and returns partial records without failing the sync', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/oauth/oauth2/token')) {
        return new Response(JSON.stringify(tokenResponse), { status: 200 });
      }
      if (url.includes('/recovery')) {
        return new Response(JSON.stringify({ records: [], next_token: 'forever' }), { status: 200 });
      }
      if (url.includes('/cycle') || url.includes('/activity/sleep')) {
        return new Response(JSON.stringify({ records: [], next_token: null }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const tokenHandler = new TokenHandler(appConfig, 'auth-code');
    await tokenHandler.authenticate();

    const result = await getFhirBundleFromWhoopData(
      { start: '2026-06-01T00:00:00.000Z', end: '2026-06-30T23:59:59.000Z' },
      tokenHandler,
      { subjectKey: 'user-1', timestamp: '2026-07-26T10:00:00Z' }
    );

    const recoveryCalls = fetchMock.mock.calls.filter(([input]) => {
      const url = typeof input === 'string' ? input : input.toString();
      return url.includes('/recovery');
    });
    expect(recoveryCalls.length).toBe(WHOOP_MAX_PAGES);
    expect(result.issues).toBeUndefined();
    expect(result.bundle.resourceType).toBe('Bundle');
  });
});

import { patientUuid, SYSTEMS } from '@open-twin/fhir-core';
import type { Observation, Patient } from 'fhir/r4';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OuraRingAppConfig } from '../../config/config';
import { getFhirBundleFromOuraData } from '../../index';
import { TokenHandler } from '../../utils/tokenUtils';

describe('getFhirBundleFromOuraData (integration)', () => {
  const appConfig: OuraRingAppConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'https://example.com/callback'
  };

  const authorizationCode = 'test-authorization-code';
  const TIMESTAMP = '2026-07-26T10:00:00Z';

  let tokenHandler: TokenHandler;

  const heartRateResponse = {
    data: [
      {
        timestamp: '2026-06-20T08:00:00+00:00',
        timestamp_unix: 1781856000000,
        bpm: 60,
        source: 'awake'
      },
      {
        timestamp: '2026-06-20T08:05:00+00:00',
        timestamp_unix: 1781856300000,
        bpm: 62,
        source: 'awake'
      }
    ],
    next_token: null
  };

  const workoutResponse = {
    data: [
      {
        id: 'workout-1',
        activity: 'running',
        source: 'confirmed',
        intensity: 'moderate',
        start_datetime: '2026-06-20T08:00:00+00:00',
        end_datetime: '2026-06-20T08:30:00+00:00',
        day: '2026-06-20',
        calories: 500,
        distance: 5000,
        label: 'Morning Run'
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

      if (url.includes('/oauth/token')) {
        return Promise.resolve(
          okJson({
            access_token: 'mock-access-token',
            token_type: 'bearer',
            refresh_token: 'mock-refresh-token',
            expires_in: 3600
          })
        );
      }

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

  it('builds a FHIR collection bundle from a list-based type (heartrate)', async () => {
    mockFetchByType({ heartrate: heartRateResponse });

    const { bundle } = await getFhirBundleFromOuraData(
      { types: ['heartrate'], start_date: '2026-06-20' },
      tokenHandler,
      {
        subjectKey: 'user-123',
        timestamp: TIMESTAMP
      }
    );

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('collection');
    expect(bundle.timestamp).toBe(TIMESTAMP);
    expect(bundle.id).toBeTruthy();
    expect(bundle.meta?.tag?.[0]).toMatchObject({ code: 'oura' });
    // Two heart-rate Observations plus the Patient they are attributed to. Without it
    // both referenced a subject that was not in the bundle.
    expect(bundle.entry).toHaveLength(3);
    expect(bundle.entry?.[0]?.resource?.resourceType).toBe('Patient');

    const observations =
      bundle.entry
        ?.map((entry) => entry.resource as Observation)
        .filter((resource) => resource.resourceType === 'Observation') ?? [];
    for (const observation of observations) {
      expect(observation.resourceType).toBe('Observation');
      expect(observation.code?.coding?.[0]).toMatchObject({ code: '8867-4', display: 'Heart rate' });
    }
    expect(observations[0].valueQuantity?.value).toBe(60);
    expect(observations[1].valueQuantity?.value).toBe(62);
  });

  it('gives every entry a resolvable urn:uuid fullUrl matching its resource id', async () => {
    mockFetchByType({ heartrate: heartRateResponse });

    const { bundle } = await getFhirBundleFromOuraData({ types: ['heartrate'] }, tokenHandler, {
      subjectKey: 'user-123',
      timestamp: TIMESTAMP
    });

    for (const entry of bundle.entry ?? []) {
      expect(entry.fullUrl).toBe(`urn:uuid:${entry.resource?.id}`);
      expect(entry.resource?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('produces the same bundle id and resource ids when the same window is re-synced', async () => {
    mockFetchByType({ heartrate: heartRateResponse });
    const options = { subjectKey: 'user-123', timestamp: TIMESTAMP };

    const first = await getFhirBundleFromOuraData(
      { types: ['heartrate'], start_date: '2026-06-20' },
      tokenHandler,
      options
    );
    const second = await getFhirBundleFromOuraData(
      { types: ['heartrate'], start_date: '2026-06-20' },
      tokenHandler,
      options
    );

    expect(second.bundle.id).toBe(first.bundle.id);
    expect(second.bundle.entry?.map((entry) => entry.fullUrl)).toEqual(
      first.bundle.entry?.map((entry) => entry.fullUrl)
    );
  });

  it('puts the Patient and its Observations flat in the bundle, not in a nested Bundle', async () => {
    mockFetchByType({ personal_info: personalResponse });

    const { bundle } = await getFhirBundleFromOuraData({ types: ['personal_info'] }, tokenHandler, {
      timestamp: TIMESTAMP
    });

    // The personal mapper used to return its own Bundle, which was then pushed as
    // one entry, so a consumer iterating entries as Observations saw none of it.
    expect(bundle.entry?.map((entry) => entry.resource?.resourceType)).toEqual([
      'Patient',
      'Observation',
      'Observation'
    ]);

    const patient = bundle.entry?.[0].resource as Patient;
    expect(patient.gender).toBe('male');
    expect(patient.identifier?.[0]).toMatchObject({ system: SYSTEMS.OURA_IDENTIFIER, value: 'user-123' });
    expect(patient.id).toBe(patientUuid('oura', 'user-123'));
  });

  it('points every Observation at the Patient entry that is actually in the bundle', async () => {
    mockFetchByType({ heartrate: heartRateResponse, personal_info: personalResponse });

    const { bundle } = await getFhirBundleFromOuraData({ types: ['personal_info', 'heartrate'] }, tokenHandler, {
      timestamp: TIMESTAMP
    });

    const patientEntry = bundle.entry?.find((entry) => entry.resource?.resourceType === 'Patient');
    const observations = (bundle.entry ?? [])
      .map((entry) => entry.resource)
      .filter((resource): resource is Observation => resource?.resourceType === 'Observation');

    expect(observations.length).toBeGreaterThan(0);
    for (const observation of observations) {
      expect(observation.subject?.reference).toBe(patientEntry?.fullUrl);
    }
  });

  it('builds a bundle from multiple requested types preserving order', async () => {
    mockFetchByType({
      heartrate: heartRateResponse,
      personal_info: personalResponse
    });

    const { bundle } = await getFhirBundleFromOuraData({ types: ['heartrate', 'personal_info'] }, tokenHandler, {
      timestamp: TIMESTAMP
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(bundle.entry?.map((entry) => entry.resource?.resourceType)).toEqual([
      'Observation',
      'Observation',
      'Patient',
      'Observation',
      'Observation'
    ]);
  });

  it('maps a workout request end to end', async () => {
    // Previously unreachable: the runtime discriminator keyed on `workout_type`,
    // a field no Oura response carries, so a workout request classified as
    // `unknown` threw and rejected every sibling type in the same call.
    mockFetchByType({ workout: workoutResponse, heartrate: heartRateResponse });

    const { bundle, issues } = await getFhirBundleFromOuraData({ types: ['workout', 'heartrate'] }, tokenHandler, {
      subjectKey: 'user-123',
      timestamp: TIMESTAMP
    });

    expect(issues).toBeUndefined();
    const workout = bundle.entry?.[1]?.resource as Observation;
    expect(workout.code?.coding?.[0]).toMatchObject({ system: SYSTEMS.OURA, code: 'workout' });
    expect(workout.component).toContainEqual(
      expect.objectContaining({
        code: { coding: [{ system: SYSTEMS.LOINC, code: '41981-2', display: 'Calories burned' }] }
      })
    );
    // Workout Observation, its two derived resources, and the Patient.
    expect(bundle.entry).toHaveLength(4);
  });

  it('uses the sandbox endpoint when the sandbox flag is enabled', async () => {
    mockFetchByType({ heartrate: heartRateResponse });

    await getFhirBundleFromOuraData({ types: ['heartrate'] }, tokenHandler, {
      sandbox: true,
      subjectKey: 'user-123',
      timestamp: TIMESTAMP
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://api.ouraring.com/v2/sandbox/usercollection/heartrate'),
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('rejects a request whose type is not a supported scope', async () => {
    await expect(
      getFhirBundleFromOuraData({ types: ['not_a_real_type'] as unknown as ['heartrate'] }, tokenHandler)
    ).rejects.toThrow();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('refuses to attribute Observations when the caller has named no subject', async () => {
    mockFetchByType({ heartrate: heartRateResponse });

    // Better than the old `Patient/example`, which resolved on the receiving
    // server to whatever example patient happened to exist there.
    await expect(getFhirBundleFromOuraData({ types: ['heartrate'] }, tokenHandler)).rejects.toThrow(
      /subject.*subjectKey.*personal_info/
    );
  });

  it('reports a non-ok status as an issue and still returns a bundle', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      if (String(input).includes('/oauth/token')) {
        return Promise.resolve(okJson({ access_token: 'mock-token', token_type: 'bearer', expires_in: 3600 }));
      }
      return Promise.resolve({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: async () => 'Unauthorized: bearer abc123'
      } as unknown as Response);
    });

    const { bundle, issues } = await getFhirBundleFromOuraData({ types: ['heartrate'] }, tokenHandler, {
      subjectKey: 'user-123',
      timestamp: TIMESTAMP
    });

    expect(bundle.entry).toEqual([]);
    expect(issues?.issue?.[0]?.code).toBe('security');
    expect(JSON.stringify(issues)).not.toContain('abc123');
  });
});

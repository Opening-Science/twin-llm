import { patientUuid } from '@open-twin/fhir-core';
import type { Observation, Patient } from 'fhir/r4';
import type { health_v4 } from 'googleapis';
import { describe, expect, it } from 'vitest';
import { buildBundleFromResponses } from '../../fhir/bundleBuilder';
import { GOOGLE_HEALTH_IDENTIFIER, SUBJECT_KEY } from '../support/context';

const OPTIONS = { subjectKey: SUBJECT_KEY, timestamp: '2026-07-26T10:00:00Z', bundleKey: 'google-health-test' };

function build(responses: health_v4.Schema$ListDataPointsResponse[]) {
  const result = buildBundleFromResponses(responses, OPTIONS);
  const resources = result.bundle.entry?.map((entry) => entry.resource) ?? [];
  return {
    ...result,
    resources,
    observations: resources.filter((r): r is Observation => r?.resourceType === 'Observation'),
    patient: resources.find((r): r is Patient => r?.resourceType === 'Patient')
  };
}

const byCode = (observations: Observation[], code: string) =>
  observations.find((observation) => observation.code?.coding?.some((coding) => coding.code === code));

describe('buildBundleFromResponses (integration)', () => {
  const heartRateResponse: health_v4.Schema$ListDataPointsResponse = {
    dataPoints: [
      {
        dataSource: {
          recordingMethod: 'UNKNOWN',
          device: {},
          application: { packageName: 'com.sec.android.app.shealth' },
          platform: 'HEALTH_CONNECT'
        },
        heartRate: {
          sampleTime: { physicalTime: '2026-07-07T05:40:29.354Z', utcOffset: '7200s' },
          beatsPerMinute: '73',
          metadata: {}
        }
      },
      {
        dataSource: {
          recordingMethod: 'UNKNOWN',
          device: {},
          application: { packageName: 'com.sec.android.app.shealth' },
          platform: 'HEALTH_CONNECT'
        },
        heartRate: {
          sampleTime: { physicalTime: '2026-07-07T05:10:29.316Z', utcOffset: '7200s' },
          beatsPerMinute: '56',
          metadata: {}
        }
      }
    ]
  };

  const distanceResponse: health_v4.Schema$ListDataPointsResponse = {
    dataPoints: [
      {
        dataSource: { recordingMethod: 'DERIVED', device: { displayName: 'MobileTrack' }, platform: 'FITBIT' },
        distance: {
          interval: {
            startTime: '2026-07-07T07:51:29Z',
            startUtcOffset: '7200s',
            endTime: '2026-07-07T07:52:29Z',
            endUtcOffset: '7200s'
          },
          millimeters: '44286'
        }
      }
    ]
  };

  const weightResponse: health_v4.Schema$ListDataPointsResponse = {
    dataPoints: [
      {
        name: 'users/8338456149191909237/dataTypes/weight/dataPoints/233475372306809440',
        dataSource: {
          recordingMethod: 'UNKNOWN',
          device: {},
          application: { packageName: 'com.sec.android.app.shealth' },
          platform: 'HEALTH_CONNECT'
        },
        weight: {
          sampleTime: { physicalTime: '2026-07-07T07:33:14.417Z', utcOffset: '7200s' },
          weightGrams: 86000
        }
      }
    ]
  };

  it('builds a FHIR bundle from multiple responses, with converted units', () => {
    const { bundle, observations } = build([heartRateResponse, distanceResponse, weightResponse]);

    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('collection');
    // Four Observations plus the Patient the Observations point at.
    expect(bundle.entry).toHaveLength(5);
    expect(observations).toHaveLength(4);

    expect(byCode(observations, '8867-4')?.valueQuantity?.value).toBe(73);
    // 44286 mm is 44.286 m. A 5 km run used to publish as 5000000.
    expect(byCode(observations, 'distance')?.valueQuantity?.value).toBe(44.286);
    // 86000 g is 86 kg.
    expect(byCode(observations, '29463-7')?.valueQuantity?.value).toBe(86);
  });

  it('emits a Patient the Observations actually resolve to', () => {
    const { bundle, observations, patient } = build([weightResponse]);

    expect(patient?.id).toBe(patientUuid('google-health', SUBJECT_KEY));
    expect(patient?.identifier).toEqual([{ system: GOOGLE_HEALTH_IDENTIFIER, value: SUBJECT_KEY }]);

    const patientEntry = bundle.entry?.find((entry) => entry.resource?.resourceType === 'Patient');
    expect(observations[0]?.subject?.reference).toBe(patientEntry?.fullUrl);
  });

  it('gives every entry a fullUrl matching its resource id', () => {
    const { bundle } = build([heartRateResponse, distanceResponse]);

    for (const entry of bundle.entry ?? []) {
      expect(entry.fullUrl).toBe(`urn:uuid:${entry.resource?.id}`);
      expect(entry.resource?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('produces the same bundle on a re-sync of the same window', () => {
    expect(build([heartRateResponse, weightResponse]).bundle).toEqual(
      build([heartRateResponse, weightResponse]).bundle
    );
  });

  it('uses a caller-supplied subject verbatim and invents no Patient', () => {
    const { bundle } = buildBundleFromResponses([weightResponse], {
      ...OPTIONS,
      subject: { reference: 'Patient/local-42' }
    });
    const resources = bundle.entry?.map((entry) => entry.resource) ?? [];

    expect(resources.some((resource) => resource?.resourceType === 'Patient')).toBe(false);
    expect((resources[0] as Observation).subject).toEqual({ reference: 'Patient/local-42' });
  });

  it('returns an empty bundle of Observations when no data points are present', () => {
    const { observations } = build([{ dataPoints: [] }]);

    expect(observations).toHaveLength(0);
  });

  it('carries the device and recording-method provenance the API supplied', () => {
    const { observations } = build([distanceResponse]);
    const distance = byCode(observations, 'distance');

    expect(distance?.status).toBe('final');
    expect(distance?.valueQuantity?.unit).toBe('meter');
    expect(distance?.valueQuantity?.system).toBe('http://unitsofmeasure.org');
    expect(distance?.device).toEqual({ display: 'MobileTrack' });
    // DERIVED says the number was estimated, not measured. It used to be dropped, so a
    // modelled distance published as if a sensor had read it.
    expect(distance?.extension?.[0]?.extension).toContainEqual({ url: 'recordingMethod', valueCode: 'DERIVED' });
    expect(distance?.extension?.[0]?.extension).toContainEqual({ url: 'platform', valueCode: 'FITBIT' });
  });

  it('carries the UTC offset the API supplied on both instants and periods', () => {
    const { observations } = build([heartRateResponse, distanceResponse]);

    const heartRate = byCode(observations, '8867-4');
    const distance = byCode(observations, 'distance');

    // The fixture carries utcOffset 7200s. Publishing everything in UTC lands a 01:00
    // local reading on the previous day downstream.
    expect(heartRate?.effectiveDateTime).toBe('2026-07-07T07:40:29.354+02:00');
    expect(heartRate?.effectivePeriod).toBeUndefined();

    expect(distance?.effectiveDateTime).toBeUndefined();
    expect(distance?.effectivePeriod?.start).toBe('2026-07-07T09:51:29.000+02:00');
    expect(distance?.effectivePeriod?.end).toBe('2026-07-07T09:52:29.000+02:00');
  });

  it("uses the DataPoint name as the Observation's business identifier when the API supplies one", () => {
    const { observations } = build([weightResponse]);

    expect(byCode(observations, '29463-7')?.identifier).toEqual([
      {
        system: GOOGLE_HEALTH_IDENTIFIER,
        value: 'users/8338456149191909237/dataTypes/weight/dataPoints/233475372306809440'
      }
    ]);
  });

  it('maps all items when a single response contains multiple data points', () => {
    const { observations } = build([heartRateResponse]);

    expect(observations).toHaveLength(2);
    expect(observations.map((observation) => observation.valueQuantity?.value)).toEqual([73, 56]);
  });

  it('stays silent about keys belonging to data types this connector never declares', () => {
    const unknownResponse = {
      dataPoints: [{ dataSource: { platform: 'HEALTH_CONNECT' }, telepathyScore: { value: 9000 } }]
    } as unknown as health_v4.Schema$ListDataPointsResponse;
    const malformedResponse: health_v4.Schema$ListDataPointsResponse = {
      dataPoints: [{ dataSource: { platform: 'FITBIT' } }]
    };

    const { observations, unmapped } = build([heartRateResponse, unknownResponse, malformedResponse]);

    expect(observations).toHaveLength(2);
    expect(unmapped).toEqual([]);
  });

  it('reports a declared data type that arrived and was dropped', () => {
    // A declared type being silently discarded is a defect in this package, and it must
    // not look identical to "the window was empty".
    const foodResponse = {
      dataPoints: [{ dataSource: { platform: 'FITBIT' }, floors: null }]
    } as unknown as health_v4.Schema$ListDataPointsResponse;

    expect(build([foodResponse]).unmapped).toEqual(['floors']);
  });

  it('handles missing or empty array fields gracefully', () => {
    const brokenResponse = { missingDataPoints: true } as unknown as health_v4.Schema$ListDataPointsResponse;

    expect(build([brokenResponse]).observations).toHaveLength(0);
  });
});

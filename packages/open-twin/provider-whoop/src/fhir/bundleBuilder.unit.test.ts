/**
 * WHAT: Fixture-level assertions for buildWhoopBundleFromPayload correctness.
 * NOT:  Must not call the live WHOOP API.
GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: asserts codes/units/values independently of whatever the mapper currently emits.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patientUuid, SYSTEMS } from '@open-twin/fhir-core';
import type { Observation } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import { WhoopSyncPayloadSchema } from '../api/schemas/sync';
import { buildWhoopBundleFromPayload } from './bundleBuilder';
import { CONNECTOR } from './mappers/shared';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures/whoop-sync.json');
const payload = WhoopSyncPayloadSchema.parse(JSON.parse(readFileSync(fixturePath, 'utf8')));

function observations(bundle: ReturnType<typeof buildWhoopBundleFromPayload>): Observation[] {
  return (bundle.entry ?? []).map((e) => e.resource).filter((r): r is Observation => r?.resourceType === 'Observation');
}

function byCode(obs: Observation[], system: string, code: string): Observation[] {
  return obs.filter((o) => o.code?.coding?.some((c) => c.system === system && c.code === code));
}

describe('buildWhoopBundleFromPayload', () => {
  const subjectKey = 'wearer-fixture-1';
  const timestamp = '2026-07-26T10:00:00Z';

  it('uses a deterministic Patient when no subject is supplied', () => {
    const bundle = buildWhoopBundleFromPayload(payload, { subjectKey, timestamp });
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('collection');
    const patient = bundle.entry?.find((e) => e.resource?.resourceType === 'Patient')?.resource;
    expect(patient?.id).toBe(patientUuid(CONNECTOR.connector, subjectKey));
  });

  it('gives every entry a unique fullUrl', () => {
    const bundle = buildWhoopBundleFromPayload(payload, { subjectKey, timestamp });
    const urls = (bundle.entry ?? []).map((e) => e.fullUrl);
    expect(urls.every(Boolean)).toBe(true);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('maps recovery score to a WHOOP-local code with UCUM score unit', () => {
    const obs = byCode(
      observations(buildWhoopBundleFromPayload(payload, { subjectKey, timestamp })),
      SYSTEMS.WHOOP,
      'recovery-score'
    );
    expect(obs).toHaveLength(1);
    expect(obs[0]?.valueQuantity).toEqual({
      value: 72,
      unit: 'score',
      system: SYSTEMS.UCUM,
      code: '{score}'
    });
  });

  it('maps HRV RMSSD in milliseconds, not seconds or unitless', () => {
    const obs = byCode(
      observations(buildWhoopBundleFromPayload(payload, { subjectKey, timestamp })),
      SYSTEMS.WHOOP,
      'hrv-rmssd'
    );
    expect(obs).toHaveLength(1);
    expect(obs[0]?.valueQuantity).toEqual({
      value: 45.2,
      unit: 'millisecond',
      system: SYSTEMS.UCUM,
      code: 'ms'
    });
  });

  it('maps resting heart rate to LOINC 8867-4 with /min', () => {
    const obs = byCode(
      observations(buildWhoopBundleFromPayload(payload, { subjectKey, timestamp })),
      SYSTEMS.LOINC,
      '8867-4'
    ).filter((o) => o.identifier?.[0]?.value?.endsWith('-rhr'));
    expect(obs).toHaveLength(1);
    expect(obs[0]?.valueQuantity).toEqual({
      value: 58,
      unit: 'per minute',
      system: SYSTEMS.UCUM,
      code: '/min'
    });
  });

  it('maps SpO2 under a WHOOP root code with LOINC 59408-5 as a component', () => {
    const obs = byCode(
      observations(buildWhoopBundleFromPayload(payload, { subjectKey, timestamp })),
      SYSTEMS.WHOOP,
      'spo2'
    );
    expect(obs).toHaveLength(1);
    expect(obs[0]?.valueQuantity).toBeUndefined();
    expect(obs[0]?.component).toContainEqual({
      code: {
        coding: [
          {
            system: SYSTEMS.LOINC,
            code: '59408-5',
            display: 'Oxygen saturation in Arterial blood by Pulse oximetry'
          },
          { system: SYSTEMS.WHOOP, code: 'spo2-percentage', display: 'SpO2 percentage' }
        ]
      },
      valueQuantity: { value: 97.5, unit: '%', system: SYSTEMS.UCUM, code: '%' }
    });
  });

  it('converts time in bed from milliseconds to minutes for LOINC 103213-5', () => {
    // Fixture: 28800000 ms = 480 min. Emitting ms as minutes would silently mis-scale.
    const obs = byCode(
      observations(buildWhoopBundleFromPayload(payload, { subjectKey, timestamp })),
      SYSTEMS.LOINC,
      '103213-5'
    );
    expect(obs).toHaveLength(1);
    expect(obs[0]?.valueQuantity).toEqual({
      value: 480,
      unit: 'minute',
      system: SYSTEMS.UCUM,
      code: 'min'
    });
  });

  it('skips naps', () => {
    const withNap = {
      ...payload,
      sleep: [
        ...payload.sleep,
        {
          id: 'nap-1',
          start: '2026-06-20T14:00:00.000Z',
          nap: true,
          score: {
            sleep_performance_percentage: 50,
            stage_summary: { total_in_bed_time_milli: 1_800_000 }
          }
        }
      ]
    };
    const obs = observations(buildWhoopBundleFromPayload(withNap, { subjectKey, timestamp }));
    expect(obs.some((o) => o.identifier?.[0]?.value === 'nap-1')).toBe(false);
  });
});

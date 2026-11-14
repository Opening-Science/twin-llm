import {
  buildBundle,
  createObservation,
  deterministicId,
  quantity,
  SYSTEMS,
  subjectReference,
  UCUM,
  type UcumUnit
} from '@open-twin/fhir-core';
import type { Bundle, Observation } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import { aggregate } from '../aggregate';

const SUBJECT_KEY = 'subject-1';
const SUBJECT = subjectReference({ connector: 'open-twin', subjectKey: SUBJECT_KEY });
const TIMESTAMP = '2026-07-27T10:00:00Z';

interface Reading {
  /** Stable vendor record id — must not depend on array position. */
  recordId: string;
  code: string;
  value: number;
  unit: UcumUnit;
  day?: string;
}

/** A bundle as a connector would emit it, so the aggregator is fed its real input. */
function bundleFrom(connector: string, readings: Reading[]): Bundle {
  const resources: Observation[] = readings.map((reading) => {
    const day = reading.day ?? '2026-06-20';
    return createObservation({
      id: deterministicId({
        connector,
        subjectKey: SUBJECT_KEY,
        recordId: reading.recordId,
        measure: reading.code
      }),
      code: { system: SYSTEMS.LOINC, code: reading.code },
      subject: SUBJECT,
      effectiveDateTime: `${day}T07:00:00+02:00`,
      valueQuantity: quantity(reading.value, reading.unit)
    });
  });
  return buildBundle({
    connector: { connector, version: '0.1.0' },
    resources,
    timestamp: TIMESTAMP,
    bundleKey: `${connector}|${SUBJECT_KEY}`
  });
}

const SLEEP = '93832-4';
const CALORIES = '41979-6';
const STEPS = '41950-7';

const observationIds = (bundle: Bundle): string[] =>
  (bundle.entry ?? [])
    .map((entry) => (entry.resource as Observation | undefined)?.id)
    .filter((id): id is string => typeof id === 'string')
    .sort();

describe('aggregate', () => {
  it('keeps every source reading, so a later policy change is a re-run and not a re-fetch', () => {
    const result = aggregate({
      sources: [
        { bundle: bundleFrom('oura', [{ recordId: 'oura-sleep', code: SLEEP, value: 402, unit: UCUM.MINUTE }]) },
        {
          bundle: bundleFrom('google-health', [
            { recordId: 'google-sleep', code: SLEEP, value: 415, unit: UCUM.MINUTE }
          ])
        }
      ],
      subjectKey: SUBJECT_KEY,
      timestamp: TIMESTAMP
    });

    const values = (result.bundle.entry ?? [])
      .map((entry) => (entry.resource as Observation).valueQuantity?.value)
      .filter((value): value is number => typeof value === 'number');
    expect(values).toContain(402);
    expect(values).toContain(415);
  });

  it('selects on published evidence rather than on the order the sources arrived', () => {
    const oura = {
      bundle: bundleFrom('oura', [{ recordId: 'oura-sleep', code: SLEEP, value: 402, unit: UCUM.MINUTE }])
    };
    const google = {
      bundle: bundleFrom('google-health', [{ recordId: 'google-sleep', code: SLEEP, value: 415, unit: UCUM.MINUTE }])
    };

    const forwards = aggregate({ sources: [oura, google], subjectKey: SUBJECT_KEY, timestamp: TIMESTAMP });
    const backwards = aggregate({ sources: [google, oura], subjectKey: SUBJECT_KEY, timestamp: TIMESTAMP });

    expect(forwards.reconciliations[0]?.selected).toBe(backwards.reconciliations[0]?.selected);
    expect(forwards.reconciliations[0]?.selected).toBeDefined();
  });

  it('refuses to name a winner for energy expenditure, where no source is dependable', () => {
    // The most useful thing the reliability table says: MAPE above 30% for every brand
    // tested. Ranking sources here would present a confidence nobody has earned.
    const result = aggregate({
      sources: [
        {
          bundle: bundleFrom('oura', [
            { recordId: 'oura-calories', code: CALORIES, value: 2300, unit: UCUM.KILOCALORIE }
          ])
        },
        {
          bundle: bundleFrom('google-health', [
            { recordId: 'google-calories', code: CALORIES, value: 2650, unit: UCUM.KILOCALORIE }
          ])
        }
      ],
      subjectKey: SUBJECT_KEY,
      timestamp: TIMESTAMP
    });

    expect(result.reconciliations[0]?.selected).toBeUndefined();
    expect(result.reconciliations[0]?.policy).toContain('No source is dependable');
    expect(result.reconciliations[0]?.policy).toContain('30%');
    const derived = (result.bundle.entry ?? []).filter((entry) => (entry.resource as Observation).derivedFrom);
    expect(derived).toHaveLength(0);
  });

  it('points the derived Observation at every source it considered, not only the winner', () => {
    const result = aggregate({
      sources: [
        { bundle: bundleFrom('oura', [{ recordId: 'oura-sleep', code: SLEEP, value: 402, unit: UCUM.MINUTE }]) },
        {
          bundle: bundleFrom('google-health', [
            { recordId: 'google-sleep', code: SLEEP, value: 415, unit: UCUM.MINUTE }
          ])
        }
      ],
      subjectKey: SUBJECT_KEY,
      timestamp: TIMESTAMP
    });

    const derived = (result.bundle.entry ?? [])
      .map((entry) => entry.resource as Observation)
      .find((resource) => resource.derivedFrom);
    expect(derived?.derivedFrom).toHaveLength(2);
    expect(derived?.method?.text).toContain('selected for total-sleep-time');
    expect(derived?.method?.coding?.[0]?.code).toBe('source-selected');
  });

  it('does not reconcile one connector with itself', () => {
    // Two readings from one device on one day is not a disagreement between sources,
    // and the evidence says nothing about choosing between a device's own readings.
    const result = aggregate({
      sources: [
        {
          bundle: bundleFrom('oura', [
            { recordId: 'oura-sleep-a', code: SLEEP, value: 402, unit: UCUM.MINUTE },
            { recordId: 'oura-sleep-b', code: SLEEP, value: 410, unit: UCUM.MINUTE }
          ])
        }
      ],
      subjectKey: SUBJECT_KEY,
      timestamp: TIMESTAMP
    });
    expect(result.reconciliations).toEqual([]);
  });

  it('abstains when the preferred connector has several readings for the same day', () => {
    const googleReadings: Reading[] = [
      { recordId: 'google-sleep-a', code: SLEEP, value: 402, unit: UCUM.MINUTE },
      { recordId: 'google-sleep-b', code: SLEEP, value: 410, unit: UCUM.MINUTE }
    ];
    const oura = {
      bundle: bundleFrom('oura', [{ recordId: 'oura-sleep', code: SLEEP, value: 415, unit: UCUM.MINUTE }])
    };

    const forwards = aggregate({
      sources: [{ bundle: bundleFrom('google-health', googleReadings) }, oura],
      subjectKey: SUBJECT_KEY,
      timestamp: TIMESTAMP
    });
    const backwards = aggregate({
      sources: [{ bundle: bundleFrom('google-health', [...googleReadings].reverse()) }, oura],
      subjectKey: SUBJECT_KEY,
      timestamp: TIMESTAMP
    });

    expect(forwards.reconciliations[0]?.selected).toBeUndefined();
    expect(forwards.reconciliations[0]?.policy).toContain('No within-source selection rule');
    expect(backwards.reconciliations).toEqual(forwards.reconciliations);
    expect((forwards.bundle.entry ?? []).filter((entry) => (entry.resource as Observation).derivedFrom)).toHaveLength(
      0
    );
  });

  it('keeps source ids and derived provenance when readings are reordered', () => {
    // google-health is preferred for total-sleep-time, so keep it to one reading and
    // reorder oura's extras — otherwise aggregation abstains and provenance is never built.
    const googleReading: Reading = {
      recordId: 'google-sleep',
      code: SLEEP,
      value: 415,
      unit: UCUM.MINUTE
    };
    const ouraReadings: Reading[] = [
      { recordId: 'oura-sleep-a', code: SLEEP, value: 402, unit: UCUM.MINUTE },
      { recordId: 'oura-sleep-b', code: SLEEP, value: 410, unit: UCUM.MINUTE }
    ];

    const forwards = aggregate({
      sources: [{ bundle: bundleFrom('google-health', [googleReading]) }, { bundle: bundleFrom('oura', ouraReadings) }],
      subjectKey: SUBJECT_KEY,
      timestamp: TIMESTAMP
    });
    const backwards = aggregate({
      sources: [
        { bundle: bundleFrom('google-health', [googleReading]) },
        { bundle: bundleFrom('oura', [...ouraReadings].reverse()) }
      ],
      subjectKey: SUBJECT_KEY,
      timestamp: TIMESTAMP
    });

    expect(observationIds(forwards.bundle)).toEqual(observationIds(backwards.bundle));

    const derivedOf = (result: ReturnType<typeof aggregate>) =>
      (result.bundle.entry ?? [])
        .map((entry) => entry.resource as Observation)
        .find((resource) => resource.derivedFrom);

    expect(derivedOf(forwards)?.derivedFrom).toHaveLength(3);
    expect(derivedOf(forwards)?.id).toBe(derivedOf(backwards)?.id);
    expect(derivedOf(forwards)?.derivedFrom).toEqual(derivedOf(backwards)?.derivedFrom);
  });

  it('rejects id-less source provenance rather than emitting urn:uuid:undefined', () => {
    const source = (connector: string, value: number): Bundle => ({
      resourceType: 'Bundle',
      type: 'collection',
      meta: { tag: [{ system: 'http://opentwin.ch/fhir/CodeSystem/connector', code: connector }] },
      entry: [
        {
          resource: createObservation({
            code: { system: SYSTEMS.LOINC, code: SLEEP },
            subject: SUBJECT,
            effectiveDateTime: '2026-06-20T07:00:00+02:00',
            valueQuantity: quantity(value, UCUM.MINUTE)
          })
        }
      ]
    });

    expect(() =>
      aggregate({
        sources: [{ bundle: source('oura', 402) }, { bundle: source('google-health', 415) }],
        subjectKey: SUBJECT_KEY,
        timestamp: TIMESTAMP
      })
    ).toThrow(/every source must have a lowercase UUID id/);
  });

  it('does not merge different days into one occasion', () => {
    const result = aggregate({
      sources: [
        {
          bundle: bundleFrom('oura', [
            { recordId: 'oura-sleep', code: SLEEP, value: 402, unit: UCUM.MINUTE, day: '2026-06-20' }
          ])
        },
        {
          bundle: bundleFrom('google-health', [
            { recordId: 'google-sleep', code: SLEEP, value: 415, unit: UCUM.MINUTE, day: '2026-06-21' }
          ])
        }
      ],
      subjectKey: SUBJECT_KEY,
      timestamp: TIMESTAMP
    });
    expect(result.reconciliations).toEqual([]);
  });

  it('carries an unmapped measure through untouched rather than guessing at it', () => {
    // Nobody has published validation evidence for step count from vitronic, and the
    // code is not in the measure map. Silence is the correct output.
    const result = aggregate({
      sources: [
        {
          bundle: bundleFrom('vitronic', [
            { recordId: 'vitronic-height', code: '8302-2', value: 178, unit: UCUM.CENTIMETRE }
          ])
        },
        {
          bundle: bundleFrom('oura', [{ recordId: 'oura-height', code: '8302-2', value: 179, unit: UCUM.CENTIMETRE }])
        }
      ],
      subjectKey: SUBJECT_KEY,
      timestamp: TIMESTAMP
    });
    expect(result.reconciliations).toEqual([]);
    expect(result.bundle.entry).toHaveLength(2);
  });

  it('abstains when the sources are graded equally, rather than breaking the tie on order', () => {
    const result = aggregate({
      sources: [
        {
          bundle: bundleFrom('oura', [{ recordId: 'oura-steps', code: STEPS, value: 9000, unit: UCUM.STEPS_PER_DAY }])
        },
        {
          bundle: bundleFrom('vitronic', [
            { recordId: 'vitronic-steps', code: STEPS, value: 9400, unit: UCUM.STEPS_PER_DAY }
          ])
        }
      ],
      subjectKey: SUBJECT_KEY,
      timestamp: TIMESTAMP
    });
    // vitronic has no step-count finding and oura has none either: both unknown.
    expect(result.reconciliations[0]?.selected).toBeUndefined();
    expect(result.reconciliations[0]?.policy).toMatch(/No validation evidence|grades these sources equally/);
  });

  it('is reproducible: the same inputs give the same bundle and derived ids', () => {
    const sources = [
      { bundle: bundleFrom('oura', [{ recordId: 'oura-sleep', code: SLEEP, value: 402, unit: UCUM.MINUTE }]) },
      {
        bundle: bundleFrom('google-health', [{ recordId: 'google-sleep', code: SLEEP, value: 415, unit: UCUM.MINUTE }])
      }
    ];
    const first = aggregate({ sources, subjectKey: SUBJECT_KEY, timestamp: TIMESTAMP });
    const second = aggregate({ sources, subjectKey: SUBJECT_KEY, timestamp: TIMESTAMP });
    expect(second.bundle.id).toBe(first.bundle.id);
    expect(second.bundle.entry?.map((entry) => entry.fullUrl)).toEqual(first.bundle.entry?.map((e) => e.fullUrl));
  });

  it('refuses to aggregate nothing', () => {
    expect(() => aggregate({ sources: [], subjectKey: SUBJECT_KEY, timestamp: TIMESTAMP })).toThrow();
  });

  it('refuses to reconcile bundles that describe different people', () => {
    // Each connector derives its subject from patientUuid(connector, key), which hashes
    // the connector in, so the same person arrives under a different reference from
    // every source. Reconciling those would attribute one person's reading to another,
    // and finding no overlap would report a wrong answer that looks like a clean one.
    const other = subjectReference({ connector: 'oura', subjectKey: SUBJECT_KEY });
    const strayed = buildBundle({
      connector: { connector: 'oura', version: '0.1.0' },
      resources: [
        createObservation({
          id: 'aaaa0000-0000-5000-8000-000000000001',
          code: { system: SYSTEMS.LOINC, code: SLEEP },
          subject: other,
          effectiveDateTime: '2026-06-20T07:00:00+02:00',
          valueQuantity: quantity(402, UCUM.MINUTE)
        })
      ],
      timestamp: TIMESTAMP,
      bundleKey: 'stray'
    });

    expect(() =>
      aggregate({
        sources: [
          {
            bundle: bundleFrom('google-health', [
              { recordId: 'google-sleep', code: SLEEP, value: 415, unit: UCUM.MINUTE }
            ])
          },
          { bundle: strayed }
        ],
        subjectKey: SUBJECT_KEY,
        timestamp: TIMESTAMP
      })
    ).toThrow(/different subjects/);
  });

  it('refuses a bundle it cannot attribute to a connector', () => {
    expect(() =>
      aggregate({
        sources: [{ bundle: { resourceType: 'Bundle', type: 'collection', entry: [] } }],
        subjectKey: SUBJECT_KEY,
        timestamp: TIMESTAMP
      })
    ).toThrow(/connector tag/);
  });
});

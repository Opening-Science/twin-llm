import { describe, expect, it } from 'vitest';
import {
  codeableComponent,
  codeableConcept,
  createObservation,
  dataAbsentReason,
  numericComponent,
  optionalNumericComponent,
  stringComponent
} from '../observation';
import { SYSTEMS } from '../systems';
import { UCUM } from '../units';

const CODE = { system: SYSTEMS.LOINC, code: '8867-4', display: 'Heart rate' };
const SUBJECT = { reference: 'urn:uuid:cd483717-65bb-5d76-a007-ddb564f6c2cb' };

describe('codeableConcept', () => {
  it('accepts several codings so two measures need not share one code', () => {
    // The defect: runVo2Max and vo2Max both emitted LOINC 94122-9, distinguishable
    // only by an invented display string, which no machine can read.
    const concept = codeableConcept([CODE, { system: SYSTEMS.OURA, code: 'resting-hr' }]);
    expect(concept.coding).toHaveLength(2);
  });

  it('omits an absent display rather than inventing one', () => {
    expect(codeableConcept({ system: SYSTEMS.LOINC, code: '8867-4' }).coding?.[0]).toEqual({
      system: SYSTEMS.LOINC,
      code: '8867-4'
    });
  });
});

describe('numericComponent', () => {
  it('requires a unit', () => {
    const component = numericComponent(CODE, 62, UCUM.PER_MINUTE);
    expect(component.valueQuantity).toEqual({
      value: 62,
      unit: 'per minute',
      system: SYSTEMS.UCUM,
      code: '/min'
    });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY]
  ])('emits dataAbsentReason rather than a bad value for %s', (_label, value) => {
    // Previously: a Quantity with a unit and no value (structurally invalid), or
    // NaN serialised as the literal string "null".
    const component = numericComponent(CODE, value as number | null | undefined, UCUM.PER_MINUTE);
    expect(component.valueQuantity).toBeUndefined();
    expect(component.dataAbsentReason?.coding?.[0]?.code).toBe('unknown');
  });

  it('never substitutes zero for a missing value', () => {
    const component = numericComponent(CODE, undefined, UCUM.SCORE);
    expect(component.valueQuantity?.value).not.toBe(0);
  });
});

describe('optionalNumericComponent', () => {
  it('omits the component entirely when the value is absent', () => {
    expect(optionalNumericComponent(CODE, null, UCUM.PER_MINUTE)).toBeUndefined();
  });
});

describe('stringComponent and codeableComponent', () => {
  it('drops empty strings', () => {
    expect(stringComponent(CODE, '')).toBeUndefined();
    expect(stringComponent(CODE, null)).toBeUndefined();
  });

  it('emits enum values as a CodeableConcept, not free text', () => {
    const component = codeableComponent(CODE, { system: SYSTEMS.OURA, code: 'easy', display: 'Easy' });
    expect(component?.valueCodeableConcept?.coding?.[0]?.code).toBe('easy');
    expect(component?.valueString).toBeUndefined();
  });
});

describe('createObservation', () => {
  it('always carries a subject', () => {
    const observation = createObservation({ code: CODE, subject: SUBJECT });
    expect(observation.subject).toEqual(SUBJECT);
  });

  it('honours FHIR obs-6: dataAbsentReason only when there is no value', () => {
    const withValue = createObservation({
      code: CODE,
      subject: SUBJECT,
      valueQuantity: { value: 62 },
      dataAbsentReason: dataAbsentReason()
    });
    expect(withValue.valueQuantity).toBeDefined();
    expect(withValue.dataAbsentReason).toBeUndefined();

    const without = createObservation({ code: CODE, subject: SUBJECT, dataAbsentReason: dataAbsentReason() });
    expect(without.dataAbsentReason?.coding?.[0]?.code).toBe('unknown');
  });

  it('prefers effectiveDateTime over effectivePeriod and never sets both', () => {
    const observation = createObservation({
      code: CODE,
      subject: SUBJECT,
      effectiveDateTime: '2026-06-20T04:00:00+03:00',
      effectivePeriod: { start: '2026-06-20T00:00:00Z' }
    });
    expect(observation.effectiveDateTime).toBe('2026-06-20T04:00:00+03:00');
    expect(observation.effectivePeriod).toBeUndefined();
  });

  it('preserves a UTC offset instead of normalising it away', () => {
    // The defect: new Date(t).toISOString() discarded the wearer's offset, shifting
    // daily summaries to the previous day for anyone east of UTC.
    const observation = createObservation({
      code: CODE,
      subject: SUBJECT,
      effectiveDateTime: '2026-06-20T04:00:00+03:00'
    });
    expect(observation.effectiveDateTime).toContain('+03:00');
  });

  it('drops undefined components instead of emitting holes', () => {
    const observation = createObservation({
      code: CODE,
      subject: SUBJECT,
      components: [undefined, numericComponent(CODE, 62, UCUM.PER_MINUTE), undefined]
    });
    expect(observation.component).toHaveLength(1);
  });

  it('omits an empty component array rather than emitting one', () => {
    expect(createObservation({ code: CODE, subject: SUBJECT, components: [undefined] }).component).toBeUndefined();
  });

  it('records declared profiles', () => {
    const observation = createObservation({
      code: CODE,
      subject: SUBJECT,
      profiles: ['http://hl7.org/fhir/StructureDefinition/heartrate']
    });
    expect(observation.meta?.profile).toContain('http://hl7.org/fhir/StructureDefinition/heartrate');
  });
});

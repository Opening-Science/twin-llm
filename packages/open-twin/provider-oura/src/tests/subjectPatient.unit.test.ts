import type { Patient } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import type { RequestParams } from '../api/schemas/client';
import { buildOuraBundle } from '../fhir/bundleBuilder';
import { parseOuraResponse } from '../utils/objectUtils';
import type { OuraTypedData } from '../utils/typeUtils';
import { ouraSandboxBundle } from '../verification/sandboxBundle';
import capture from './fixtures/sandbox-capture.json';

/**
 * Every Observation must be answerable inside the bundle that carries it.
 *
 * `personal_info` is what normally puts the Patient there. Oura's sandbox returns 404
 * for it and a caller can simply not request it, so the ordinary path produced a
 * bundle in which all 73 Observations referenced a Patient that did not exist. The
 * offline validator calls that a warning rather than an error, which is exactly why no
 * gate caught it: `-tx n/a` reported Success while every reference dangled.
 *
 * These run on the recorded sandbox capture rather than on literals, because a literal
 * written next to the mapper cannot contradict the mapper.
 */

const SCOPES = Object.keys(capture as Record<string, unknown>);
const REQUEST: RequestParams = {
  types: SCOPES as RequestParams['types'],
  start_date: '2026-06-20',
  end_date: '2026-06-27'
};
const captured = (): OuraTypedData[] =>
  SCOPES.map((scope) => parseOuraResponse(scope as never, (capture as Record<string, unknown>)[scope] as never));

const patientsIn = (entries: { resource?: { resourceType?: string } }[] = []): Patient[] =>
  entries.map((e) => e.resource).filter((r): r is Patient => r?.resourceType === 'Patient');

describe('the subject a bundle points at', () => {
  it('the capture carries no personal_info, which is the case this covers', () => {
    // If Oura ever starts serving it in the sandbox, these tests stop testing anything
    // and should be re-pointed rather than quietly passing.
    expect(SCOPES).not.toContain('personal_info');
  });

  it('synthesises a Patient when the vendor supplied no demographics', () => {
    expect(patientsIn(ouraSandboxBundle().entry)).toHaveLength(1);
  });

  it('leaves no Observation referencing a Patient outside the bundle', () => {
    const bundle = ouraSandboxBundle();
    const ids = new Set((bundle.entry ?? []).map((e) => `urn:uuid:${(e.resource as { id?: string })?.id}`));
    const subjects = (bundle.entry ?? [])
      .map((e) => (e.resource as { subject?: { reference?: string } })?.subject?.reference)
      .filter((r): r is string => typeof r === 'string');

    expect(subjects.length).toBeGreaterThan(50);
    for (const reference of subjects) expect(ids).toContain(reference);
  });

  it('does not synthesise one when the caller pointed at their own Patient', () => {
    // The caller's system already holds the record. A second Patient under our own
    // deterministic id would fork one person into two.
    const bundle = buildOuraBundle(captured(), REQUEST, {
      subject: { reference: 'Patient/known-to-the-integrator' },
      subjectKey: 'sandbox-subject',
      timestamp: '2026-07-26T10:00:00Z'
    });
    expect(patientsIn(bundle.entry)).toHaveLength(0);
    const subjects = new Set(
      (bundle.entry ?? []).map((e) => (e.resource as { subject?: { reference?: string } })?.subject?.reference)
    );
    expect(subjects).toContain('Patient/known-to-the-integrator');
  });

  it('is stable across syncs, so re-ingesting does not duplicate the Patient', () => {
    const first = patientsIn(ouraSandboxBundle().entry)[0]?.id;
    const second = patientsIn(ouraSandboxBundle().entry)[0]?.id;
    // Asserted before the comparison: without it, two absent Patients compare equal and
    // this passes with the defect restored, which is how it first read.
    expect(first).toBeDefined();
    expect(second).toBe(first);
  });
});

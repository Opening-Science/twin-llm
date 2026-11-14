/**
 * WHAT: Maps one vendor record type into FHIR Observation(s).
 * NOT:  Must not call vendor HTTP; must not invent LOINC/SNOMED — use allowlisted codes or vendor-local SYSTEMS.*.
GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: signed review record (verify/terminology-allowlist.json) for LOINC/SNOMED emitted here; UCUM gate for quantities.
 */
import {
  CATEGORY,
  codeableComponent,
  createObservation,
  dataAbsentReason,
  LOINC_CODINGS,
  optionalNumericComponent,
  UCUM
} from '@open-twin/fhir-core';
import type { Extension, Observation } from 'fhir/r4';
import type { PublicSample, SessionList } from '../../api/schemas/session';
import { type OuraMapperContext, ouraCoding, ouraExtensionUrl, ouraIdentifier, ouraResourceId } from './shared';

function averageSample(sample: PublicSample | null): number | undefined {
  if (!sample?.items || sample.items.length === 0) return undefined;
  const values = sample.items.filter((value): value is number => value !== null);
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function mapOuraSessionToFHIR(ouraData: SessionList, context: OuraMapperContext): Observation[] {
  if (!ouraData?.data || ouraData.data.length === 0) return [];

  return ouraData.data.map((session) => {
    const extensions: Extension[] = [
      { url: ouraExtensionUrl('session-type'), valueString: session.type },
      { url: ouraExtensionUrl('session-day'), valueString: session.day }
    ];

    const observation = createObservation({
      id: ouraResourceId(context, session.id, 'session'),
      identifier: ouraIdentifier(session.id),
      code: ouraCoding('session', 'Oura Session'),
      codeText: session.type,
      category: CATEGORY.ACTIVITY,
      subject: context.subject,
      effectivePeriod: { start: session.start_datetime, end: session.end_datetime },
      dataAbsentReason: dataAbsentReason('not-applicable'),
      components: [
        // This is the arithmetic mean of the session's samples, not a spot
        // reading. Bare LOINC 8867-4 cannot express that, and a receiver would
        // read a 15-minute meditation mean as an instantaneous beat, so the
        // second coding names the statistic. Distinguishing two measures by a
        // free-text display on one shared code is what this avoids.
        optionalNumericComponent(
          [LOINC_CODINGS.HEART_RATE, ouraCoding('session-mean-heart-rate', 'Session Mean Heart Rate')],
          averageSample(session.heart_rate),
          UCUM.PER_MINUTE
        ),
        optionalNumericComponent(
          ouraCoding('session-mean-heart-rate-variability', 'Session Mean Heart Rate Variability'),
          averageSample(session.heart_rate_variability),
          UCUM.MILLISECOND
        ),
        optionalNumericComponent(
          ouraCoding('session-mean-motion-count', 'Session Mean Motion Count'),
          averageSample(session.motion_count),
          UCUM.COUNT
        ),
        // `mood` is a closed value set. As a free-text extension no receiver could
        // bind it; as a CodeableConcept it is machine-readable.
        codeableComponent(
          ouraCoding('session-mood', 'Session Mood'),
          session.mood === null ? undefined : ouraCoding(session.mood)
        )
      ]
    });

    observation.extension = extensions;
    return observation;
  });
}

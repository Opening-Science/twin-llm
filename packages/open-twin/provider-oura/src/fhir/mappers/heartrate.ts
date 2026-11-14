/**
 * WHAT: Maps one vendor record type into FHIR Observation(s).
 * NOT:  Must not call vendor HTTP; must not invent LOINC/SNOMED — use allowlisted codes or vendor-local SYSTEMS.*.
GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: signed review record (verify/terminology-allowlist.json) for LOINC/SNOMED emitted here; UCUM gate for quantities.
 */
import {
  CATEGORY,
  createObservation,
  dataAbsentReason,
  LOINC_CODINGS,
  PROFILES,
  quantity,
  UCUM
} from '@open-twin/fhir-core';
import type { Extension, Observation } from 'fhir/r4';
import type { OuraHeartRateList } from '../../api/schemas/heartrate';
import { type OuraMapperContext, ouraExtensionUrl, ouraResourceId } from './shared';

export function mapOuraHeartRateToFHIR(ouraData: OuraHeartRateList, context: OuraMapperContext): Observation[] {
  if (!ouraData?.data || ouraData.data.length === 0) return [];

  return ouraData.data.map((hr) => {
    // One url per concept. Both extensions previously shared a single url, so a
    // consumer could not tell the source from the unix timestamp.
    const extensions: Extension[] = [{ url: ouraExtensionUrl('heart-rate-source'), valueString: hr.source }];
    if (hr.timestamp_unix !== undefined) {
      extensions.push({
        url: ouraExtensionUrl('heart-rate-timestamp-unix'),
        valueString: hr.timestamp_unix.toString()
      });
    }

    const observation = createObservation({
      id: ouraResourceId(context, hr.timestamp, 'heart-rate'),
      code: LOINC_CODINGS.HEART_RATE,
      category: CATEGORY.VITAL_SIGNS,
      subject: context.subject,
      effectiveDateTime: hr.timestamp,
      // `bpm ?? 0` was a fallback on a required field, so a loosened schema or an
      // unvalidated caller would publish a 0 bpm vital sign, which reads as
      // asystole. Absence is dataAbsentReason.
      valueQuantity: quantity(hr.bpm, UCUM.PER_MINUTE),
      dataAbsentReason: dataAbsentReason(),
      // The R4 heart-rate profile *fixes* valueQuantity.code to `/min`, which is
      // why `{beats}/min` is not used even though it is LOINC's example unit.
      profiles: [PROFILES.HEART_RATE]
    });

    observation.extension = extensions;
    return observation;
  });
}

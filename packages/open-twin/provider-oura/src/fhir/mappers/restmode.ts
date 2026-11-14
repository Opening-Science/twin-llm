/**
 * WHAT: Maps one vendor record type into FHIR Observation(s).
 * NOT:  Must not call vendor HTTP; must not invent LOINC/SNOMED — use allowlisted codes or vendor-local SYSTEMS.*.
GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: signed review record (verify/terminology-allowlist.json) for LOINC/SNOMED emitted here; UCUM gate for quantities.
 */
import { CATEGORY, createObservation, dataAbsentReason } from '@open-twin/fhir-core';
import type { Extension, Observation } from 'fhir/r4';
import type { OuraRestModeList } from '../../api/schemas/restmode';
import { type OuraMapperContext, ouraCoding, ouraExtensionUrl, ouraIdentifier, ouraResourceId } from './shared';

export function mapOuraRestModeToFHIR(ouraData: OuraRestModeList, context: OuraMapperContext): Observation[] {
  if (!ouraData?.data || ouraData.data.length === 0) return [];

  return ouraData.data.map((restMode) => {
    // Three distinct concepts, three distinct urls. All of them — including every
    // episode — previously shared one url, so a consumer reading the extension
    // array could not tell a start day from an end day from an episode timestamp.
    const extensions: Extension[] = [];
    if (restMode.start_day !== null) {
      extensions.push({ url: ouraExtensionUrl('rest-mode-start-day'), valueString: restMode.start_day });
    }
    if (restMode.end_day !== null) {
      extensions.push({ url: ouraExtensionUrl('rest-mode-end-day'), valueString: restMode.end_day });
    }
    for (const episode of restMode.episodes ?? []) {
      const tags = episode.tag && episode.tag.length > 0 ? ` [${episode.tag.join(', ')}]` : '';
      extensions.push({
        url: ouraExtensionUrl('rest-mode-episode'),
        valueString: `${episode.timestamp}${tags}`
      });
    }

    const observation = createObservation({
      id: ouraResourceId(context, restMode.id, 'rest-mode-period'),
      identifier: ouraIdentifier(restMode.id),
      code: ouraCoding('rest-mode', 'Oura Rest Mode'),
      category: CATEGORY.ACTIVITY,
      subject: context.subject,
      effectivePeriod: { start: restMode.start_time, end: restMode.end_time },
      // A rest-mode period is an interval, not a measurement: it has no value by
      // construction, which is what 'not-applicable' says.
      dataAbsentReason: dataAbsentReason('not-applicable')
    });

    if (extensions.length > 0) observation.extension = extensions;
    return observation;
  });
}

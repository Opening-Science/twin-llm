/**
 * WHAT: Maps one vendor record type into FHIR Observation(s).
 * NOT:  Must not call vendor HTTP; must not invent LOINC/SNOMED — use allowlisted codes or vendor-local SYSTEMS.*.
GOVERNED BY: DECISIONS.md#d4
 * CORRECTNESS: signed review record (verify/terminology-allowlist.json) for LOINC/SNOMED emitted here; UCUM gate for quantities.
 */
import { CATEGORY, createObservation, dataAbsentReason, optionalNumericComponent, UCUM } from '@open-twin/fhir-core';
import type { Extension, Observation } from 'fhir/r4';
import type { OuraWorkoutList } from '../../api/schemas/workout';
import { LOINC, type OuraMapperContext, ouraCoding, ouraExtensionUrl, ouraIdentifier, ouraResourceId } from './shared';

export function mapOuraWorkoutToFHIR(ouraData: OuraWorkoutList, context: OuraMapperContext): Observation[] {
  if (!ouraData?.data || ouraData.data.length === 0) return [];

  return ouraData.data.map((workout) => {
    // One url per concept: source, intensity, day and label previously shared a
    // single url and were therefore mutually indistinguishable.
    const extensions: Extension[] = [
      { url: ouraExtensionUrl('workout-source'), valueString: workout.source },
      { url: ouraExtensionUrl('workout-intensity'), valueString: workout.intensity },
      { url: ouraExtensionUrl('workout-day'), valueString: workout.day }
    ];
    // `label` is both optional and nullable, so `!== null` let an absent label
    // through and pushed an extension with no value[x], violating ext-1.
    if (workout.label != null) {
      extensions.push({ url: ouraExtensionUrl('workout-label'), valueString: workout.label });
    }

    const observation = createObservation({
      id: ouraResourceId(context, workout.id, 'workout'),
      identifier: ouraIdentifier(workout.id),
      code: ouraCoding('workout', 'Oura Workout'),
      codeText: workout.activity,
      category: CATEGORY.ACTIVITY,
      subject: context.subject,
      effectivePeriod: { start: workout.start_datetime, end: workout.end_datetime },
      // The workout itself is a grouper: the measurements are its components.
      // Saying so explicitly is better than an Observation that silently carries
      // neither a value nor a reason for its absence.
      dataAbsentReason: dataAbsentReason('not-applicable'),
      components: [
        // LOINC 41981-2 "Calories burned" has TIME = Pt and example unit `kcal` —
        // one activity. 41979-6, used here before, is the 24-hour total, so a
        // 30-minute workout burning 500 kcal was published as a whole day's
        // energy expenditure. Open mHealth's `calories-burned-2.0` cites 41981-2
        // for exactly this shape: a measure carrying an activity name and an
        // interval, which is what a workout is.
        optionalNumericComponent(LOINC.CALORIES_BURNED, workout.calories, UCUM.KILOCALORIE),
        optionalNumericComponent(ouraCoding('workout-distance', 'Workout Distance'), workout.distance, UCUM.METRE)
      ]
    });

    observation.extension = extensions;
    return observation;
  });
}

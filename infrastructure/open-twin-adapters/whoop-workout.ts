// The pinned provider-whoop fetches and maps recovery, cycles and sleep only.
// Workouts (GET /v2/activity/workout, scope read:workout) are fetched and mapped
// here until upstream has them (docs/open-twin-pins.md). Only the public
// fhir-core barrel is used. No server-only so tests can map a fixture.
import {
  buildBundle,
  CATEGORY,
  ConnectorError,
  createObservation,
  dataAbsentReason,
  deterministicId,
  fromHttpStatus,
  minimalPatient,
  optionalNumericComponent,
  SYSTEMS,
  subjectReference,
  UCUM,
  type CodingInput,
} from "@open-twin/fhir-core";
import type { Bundle, FhirResource, Observation, Reference } from "fhir/r4";
import { z } from "zod";

const WHOOP_API_BASE = "https://api.prod.whoop.com/developer/v2";
const WORKOUT_PATH = "/activity/workout";
/** Same cap as upstream, so a stuck next_token cannot loop forever. */
const MAX_PAGES = 100;
/** Same tag the upstream mappers write, so every Whoop resource reads as one connector. */
const CONNECTOR = { connector: "whoop", version: "0.1.0" } as const;

const ZoneDurationsSchema = z.object({
  zone_zero_milli: z.number().optional(),
  zone_one_milli: z.number().optional(),
  zone_two_milli: z.number().optional(),
  zone_three_milli: z.number().optional(),
  zone_four_milli: z.number().optional(),
  zone_five_milli: z.number().optional(),
});

const WorkoutScoreSchema = z.object({
  strain: z.number().optional(),
  average_heart_rate: z.number().optional(),
  max_heart_rate: z.number().optional(),
  kilojoule: z.number().optional(),
  percent_recorded: z.number().optional(),
  distance_meter: z.number().nullable().optional(),
  altitude_gain_meter: z.number().nullable().optional(),
  altitude_change_meter: z.number().nullable().optional(),
  zone_durations: ZoneDurationsSchema.optional(),
});

export const WhoopWorkoutSchema = z.object({
  id: z.coerce.string(),
  start: z.string(),
  end: z.string(),
  sport_name: z.string().optional(),
  score_state: z.string().optional(),
  score: WorkoutScoreSchema.optional(),
});

export type WhoopWorkout = z.infer<typeof WhoopWorkoutSchema>;

const WorkoutPageSchema = z.object({
  records: z.array(WhoopWorkoutSchema),
  next_token: z.string().nullable().optional(),
});

/** Zone index (0–5) with the Whoop field that carries its milliseconds. */
export const WHOOP_HR_ZONES = [
  [0, "zone_zero_milli"],
  [1, "zone_one_milli"],
  [2, "zone_two_milli"],
  [3, "zone_three_milli"],
  [4, "zone_four_milli"],
  [5, "zone_five_milli"],
] as const satisfies readonly (readonly [
  number,
  keyof z.infer<typeof ZoneDurationsSchema>,
])[];

/** A Whoop sport name for display; v2 always sends one, older rows may not. */
export const whoopSportName = (workout: WhoopWorkout): string =>
  workout.sport_name?.trim() || "workout";

/** All workouts in the window, following next_token. Throws a ConnectorError on any failure. */
export const fetchWhoopWorkouts = async (
  accessToken: string,
  window: { readonly start: string; readonly end: string },
): Promise<WhoopWorkout[]> => {
  const operation = `GET ${WORKOUT_PATH}`;
  const records: WhoopWorkout[] = [];
  let nextToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${WHOOP_API_BASE}${WORKOUT_PATH}`);
    url.searchParams.set("start", window.start);
    url.searchParams.set("end", window.end);
    url.searchParams.set("limit", "25");
    if (nextToken) url.searchParams.set("nextToken", nextToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw fromHttpStatus(response.status, {
        connector: CONNECTOR.connector,
        operation,
      });
    }

    const parsed = WorkoutPageSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new ConnectorError(
        "Whoop workout response did not match the expected shape",
        {
          code: "validation",
          connector: CONNECTOR.connector,
          status: response.status,
          operation,
        },
      );
    }

    records.push(...parsed.data.records);
    if (!parsed.data.next_token) return records;
    nextToken = parsed.data.next_token;
  }
  return records;
};

const whoopCoding = (code: string, display: string): CodingInput => ({
  system: SYSTEMS.WHOOP,
  code,
  display,
});

/**
 * LOINC 41981-2 "Calories burned" is the point-in-time energy of one activity,
 * the code provider-oura uses for a workout. Its unit is kcal, so Whoop's
 * kilojoules are converted (1 kcal = 4.184 kJ).
 */
const CALORIES_BURNED: CodingInput = {
  system: SYSTEMS.LOINC,
  code: "41981-2",
  display: "Calories burned",
};

const KJ_PER_KCAL = 4.184;

const kilocalories = (kilojoule: number | undefined): number | undefined =>
  kilojoule === undefined ? undefined : Math.round((kilojoule / KJ_PER_KCAL) * 10) / 10;

type MapperContext = Readonly<{ subject: Reference; subjectKey: string }>;

/**
 * One Observation per scored workout. Like an Oura workout it is a grouper:
 * the measurements are components and the root says so with
 * dataAbsentReason `not-applicable`. Heart rates stay vendor-coded because no
 * reviewed LOINC code means "average/maximum over one workout".
 */
export const mapWhoopWorkoutsToFHIR = (
  rows: readonly WhoopWorkout[],
  context: MapperContext,
): Observation[] =>
  rows.flatMap((workout) => {
    const score = workout.score;
    if (!score) return [];
    const zones = score.zone_durations;
    return [
      createObservation({
        id: deterministicId({
          connector: CONNECTOR.connector,
          subjectKey: context.subjectKey,
          recordId: workout.id,
          measure: "workout",
        }),
        identifier: [{ system: SYSTEMS.WHOOP_IDENTIFIER, value: workout.id }],
        code: whoopCoding("workout", "WHOOP workout"),
        codeText: whoopSportName(workout),
        category: CATEGORY.ACTIVITY,
        subject: context.subject,
        effectivePeriod: { start: workout.start, end: workout.end },
        dataAbsentReason: dataAbsentReason("not-applicable"),
        components: [
          optionalNumericComponent(
            whoopCoding("workout-strain", "WHOOP workout strain"),
            score.strain,
            UCUM.SCORE,
          ),
          optionalNumericComponent(
            whoopCoding("workout-average-heart-rate", "WHOOP workout average heart rate"),
            score.average_heart_rate,
            UCUM.PER_MINUTE,
          ),
          optionalNumericComponent(
            whoopCoding("workout-max-heart-rate", "WHOOP workout maximum heart rate"),
            score.max_heart_rate,
            UCUM.PER_MINUTE,
          ),
          optionalNumericComponent(
            CALORIES_BURNED,
            kilocalories(score.kilojoule),
            UCUM.KILOCALORIE,
          ),
          optionalNumericComponent(
            whoopCoding("workout-distance", "WHOOP workout distance"),
            score.distance_meter,
            UCUM.METRE,
          ),
          ...WHOOP_HR_ZONES.map(([zone, field]) =>
            optionalNumericComponent(
              whoopCoding(
                `workout-hr-zone-${zone}`,
                `WHOOP heart rate zone ${zone} duration`,
              ),
              zones?.[field],
              UCUM.MILLISECOND,
            ),
          ),
        ],
      }),
    ];
  });

/**
 * Adds workout Observations to the bundle provider-whoop built for recovery,
 * cycles and sleep. With no scored workout the upstream bundle is returned as is.
 */
export const withWhoopWorkouts = (
  base: Bundle,
  workouts: readonly WhoopWorkout[],
  options: { readonly subjectKey: string; readonly timestamp: string },
): Bundle => {
  const subject = subjectReference({
    connector: CONNECTOR.connector,
    subjectKey: options.subjectKey,
  });
  const mapped = mapWhoopWorkoutsToFHIR(workouts, {
    subject,
    subjectKey: options.subjectKey,
  });
  if (mapped.length === 0) return base;

  const existing = (base.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is FhirResource => resource !== undefined);
  const hasPatient = existing.some((resource) => resource.resourceType === "Patient");
  const patient = hasPatient
    ? []
    : [
        minimalPatient({
          connector: CONNECTOR.connector,
          subjectKey: options.subjectKey,
          identifierSystem: SYSTEMS.WHOOP_IDENTIFIER,
        }),
      ];

  return buildBundle({
    connector: CONNECTOR,
    resources: [...patient, ...existing, ...mapped],
    timestamp: options.timestamp,
    bundleKey: [
      CONNECTOR.connector,
      options.subjectKey,
      "recovery,cycle,sleep,workout",
    ].join("|"),
  });
};

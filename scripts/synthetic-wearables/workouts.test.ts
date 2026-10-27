import { describe, expect, test } from "bun:test";

import {
  SYNTHETIC_WORKOUT_CODES,
  syntheticWorkouts,
} from "../../packages/query-tools/wearable-readings";
import { mapObservations } from "../../packages/warehouse/map-observation";

import { stableUuid, wearableBundle } from "./bundle";
import { generateSeries } from "./series";
import {
  generateWorkouts,
  WORKOUT_METRIC_NAMES,
  WORKOUT_METRICS,
  workoutProfile,
} from "./workouts";

const OPTIONS = {
  seed: 4242,
  subjectRef: "subject-0001",
  endDay: "2026-10-01",
  days: 90,
} as const;

describe("workoutProfile", () => {
  test("is fixed for a seed and subject", () => {
    expect(workoutProfile(4242, "subject-0001")).toEqual({
      rate: 0.241,
      usual: "workout_cycling",
    });
  });
});

describe("generateWorkouts", () => {
  const series = generateSeries(OPTIONS);
  const workouts = generateWorkouts(OPTIONS, series);

  test("gives exact values for a fixed seed", () => {
    expect(workouts.length).toBe(23);
    expect(workouts.slice(0, 4)).toEqual([
      { day: "2026-07-05", metric: "workout_running", value: 46 },
      { day: "2026-07-09", metric: "workout_cycling", value: 51 },
      { day: "2026-07-22", metric: "workout_strength", value: 25 },
      { day: "2026-07-29", metric: "workout_cycling", value: 63 },
    ]);
  });

  test("left the daily series as it was", () => {
    expect(series.length).toBe(567);
    expect(series[0]).toEqual({
      day: "2026-07-04",
      metric: "heart_rate",
      value: 74,
    });
  });

  test("only on worn days, one a day at most", () => {
    const worn = new Set(series.map((reading) => reading.day));
    expect(workouts.filter((workout) => !worn.has(workout.day))).toEqual([]);
    expect(new Set(workouts.map((workout) => workout.day)).size).toBe(workouts.length);
  });

  test("stays between 10 and 150 minutes for 200 subjects", () => {
    const outside = Array.from({ length: 200 }, (_, index) => {
      const options = { ...OPTIONS, subjectRef: `s${index}` };
      return generateWorkouts(options, generateSeries(options));
    })
      .flat()
      .filter((workout) => workout.value < 10 || workout.value > 150);
    expect(outside).toEqual([]);
  });

  test("uses the codes training_load reads, in minutes", () => {
    expect(
      WORKOUT_METRIC_NAMES.map((name) => [
        WORKOUT_METRICS[name].code,
        WORKOUT_METRICS[name].unit,
      ]),
    ).toEqual(SYNTHETIC_WORKOUT_CODES.map((code) => [code, "min"]));
  });

  test("maps to warehouse rows that training_load reads back", () => {
    const patient = {
      resourceType: "Patient",
      id: "p-1",
      identifier: [
        { system: "https://github.com/synthetichealth/synthea", value: "p-1" },
      ],
      deceased: false,
    } as const;
    const bundle = wearableBundle(patient, [workouts[0]!]);
    const rows = bundle.entry.flatMap((entry) => mapObservations(entry.resource));
    expect(rows).toEqual([
      {
        kind: "numeric",
        row: {
          loinc: "workout-running",
          display: "Workout duration, running (synthetic)",
          value: 46,
          unitUcum: "min",
          effectiveAt: new Date("2026-07-05T18:00:00Z"),
          fhirId: stableUuid(
            "twinllm-synthetic-wearables:p-1:workout_running:2026-07-05",
          ),
        },
      },
    ]);
    const row = rows[0];
    if (row?.kind !== "numeric") throw new Error("expected a numeric row");
    expect(syntheticWorkouts([row.row])).toEqual([
      {
        source: "synthetic",
        day: "2026-07-05",
        sport: "running",
        session: "running",
        field: "minutes",
        value: 46,
        unit: "min",
      },
    ]);
  });
});

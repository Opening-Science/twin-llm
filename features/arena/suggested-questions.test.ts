import { describe, expect, test } from "bun:test";

import type {
  CoverageResult,
  WearableCoverageResult,
} from "@/packages/query-tools/tools";

import {
  COHORT_SUGGESTION_LOINCS,
  cohortSuggestions,
  wearableSuggestionKeys,
  wearableSuggestions,
} from "./suggested-questions";

const SUBJECT = { ref: "synthetic-subject-1", label: "Synthetic person 1" };

/** A coverage result for the suggestion codes, with `n` readings per listed code. */
const cohortCoverage = (counts: Readonly<Record<string, number>>): CoverageResult => ({
  start: "1900-01-01",
  end: "2026-10-27",
  days_in_window: 46_320,
  codes: COHORT_SUGGESTION_LOINCS.map((loinc) => ({
    loinc,
    unit: null,
    n: counts[loinc] ?? 0,
    days_with_data: counts[loinc] ?? 0,
    coverage_ratio: 0,
    longest_gap_days: 0,
  })),
});

const wearableCoverage = (
  days: Readonly<Record<string, number>>,
): WearableCoverageResult => ({
  start: "2026-10-01",
  end: "2026-10-14",
  days_in_window: 14,
  measures: Object.entries(days).map(([key, count]) => ({
    key,
    n: count,
    days_with_data: count,
    coverage_ratio: count / 14,
    longest_gap_days: 14 - count,
  })),
});

const labels = (result: ReturnType<typeof cohortSuggestions>): readonly string[] =>
  result.questions.map((question) => question.label);

describe("cohortSuggestions", () => {
  test("vitals and labs: one question per family, most readings first, then a chart", () => {
    const result = cohortSuggestions(
      SUBJECT,
      cohortCoverage({
        "8867-4": 12,
        "8480-6": 12,
        "8462-4": 12,
        "4548-4": 5,
        "2093-3": 1,
      }),
    );
    expect(result).toEqual({
      heading: "From Synthetic person 1, synthetic",
      questions: [
        {
          label: "How has their heart rate changed across their records?",
          prompt:
            "For synthetic subject synthetic-subject-1, using LOINC 8867-4, how has their heart rate changed across their records?",
        },
        {
          label: "How has their blood pressure changed across their records?",
          prompt:
            "For synthetic subject synthetic-subject-1, using LOINC 8480-6, 8462-4, how has their blood pressure changed across their records?",
        },
        {
          label: "What was their latest HbA1c?",
          prompt:
            "For synthetic subject synthetic-subject-1, using LOINC 4548-4, what was their latest HbA1c?",
        },
        {
          label: "What were their latest cholesterol and triglyceride results?",
          prompt:
            "For synthetic subject synthetic-subject-1, using LOINC 2093-3, what were their latest cholesterol and triglyceride results?",
        },
        {
          label: "Show a chart of their heart rate across their records.",
          prompt:
            "For synthetic subject synthetic-subject-1, using LOINC 8867-4, show a chart of their heart rate across their records.",
        },
      ],
    });
  });

  test("no lab rows: no lab question; under 3 readings asks for the latest; no chart under 10", () => {
    const result = cohortSuggestions(
      SUBJECT,
      cohortCoverage({ "8867-4": 2, "29463-7": 4, "39156-5": 4 }),
    );
    expect(labels(result)).toEqual([
      "How has their body weight changed across their records?",
      "How has their BMI changed across their records?",
      "What was their latest heart rate?",
    ]);
  });

  test("Synthea's yearly visits: five vitals tie, so the listed order decides", () => {
    const result = cohortSuggestions(
      SUBJECT,
      cohortCoverage({
        "8867-4": 13,
        "8480-6": 13,
        "8462-4": 13,
        "29463-7": 13,
        "39156-5": 13,
        "9279-1": 13,
      }),
    );
    expect(labels(result)).toEqual([
      "How has their heart rate changed across their records?",
      "How has their blood pressure changed across their records?",
      "How has their body weight changed across their records?",
      "How has their BMI changed across their records?",
      "Show a chart of their heart rate across their records.",
    ]);
  });

  test("the chart goes to the busiest family that can be drawn", () => {
    const result = cohortSuggestions(
      SUBJECT,
      cohortCoverage({ "8480-6": 20, "8462-4": 20, "29463-7": 11 }),
    );
    expect(labels(result)).toEqual([
      "How has their blood pressure changed across their records?",
      "How has their body weight changed across their records?",
      "Show a chart of their body weight across their records.",
    ]);
  });

  test("a subject with no rows gets no chips", () => {
    expect(cohortSuggestions(SUBJECT, cohortCoverage({}))).toEqual({
      heading: "From Synthetic person 1, synthetic",
      questions: [],
    });
  });
});

describe("wearableSuggestions", () => {
  test("wearable-only: the person's own families, most days first, with the day count", () => {
    const result = wearableSuggestions(
      wearableCoverage({
        "whoop.recovery.rhr": 14,
        "whoop.recovery.hrv": 14,
        "whoop.sleep.performance": 13,
        "whoop.recovery.score": 2,
        "whoop.workout.strain.running": 3,
      }),
    );
    expect(result).toEqual({
      heading: "From your linked wearables",
      questions: [
        {
          label: "How has my resting heart rate changed across my 14 days of readings?",
          prompt: "How has my resting heart rate changed across my 14 days of readings?",
        },
        {
          label: "How has my HRV changed across my 14 days of readings?",
          prompt: "How has my HRV changed across my 14 days of readings?",
        },
        {
          label: "How has my sleep changed across my 13 nights of readings?",
          prompt: "How has my sleep changed across my 13 nights of readings?",
        },
        {
          label: "Which workouts are in my synced data?",
          prompt: "Which workouts are in my synced data?",
        },
        {
          label: "Show a chart of my resting heart rate.",
          prompt: "Show a chart of my resting heart rate.",
        },
      ],
    });
  });

  test("a family's readings are its busiest key's, and a key with no days asks nothing", () => {
    const result = wearableSuggestions(
      wearableCoverage({
        "sleep.score": 5,
        "sleep.duration": 7,
        "activity.steps": 0,
        "readiness.score": 1,
      }),
    );
    expect(result.questions.map((question) => question.label)).toEqual([
      "How has my sleep changed across my 7 nights of readings?",
      "What was my latest readiness score?",
    ]);
  });

  test("nothing linked: no chips", () => {
    expect(wearableSuggestions(wearableCoverage({})).questions).toEqual([]);
  });
});

describe("wearableSuggestionKeys", () => {
  test("keeps only keys some family asks about, sorted and once each", () => {
    expect(
      wearableSuggestionKeys([
        "sleep.score",
        "sleep.hr",
        "whoop.recovery.rhr",
        "sleep.score",
        "vitronic.waist",
        "google.steps",
        "workout.duration.cycling",
        "sleep.hrv.nap",
      ]),
    ).toEqual([
      "google.steps",
      "sleep.hrv.nap",
      "sleep.score",
      "whoop.recovery.rhr",
      "workout.duration.cycling",
    ]);
  });
});

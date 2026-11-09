import { describe, expect, test } from "bun:test";

import type {
  CoverageResult,
  WearableCoverageResult,
} from "@/packages/query-tools/tools";

import {
  COHORT_SUGGESTION_LOINCS,
  cohortSuggestions,
  labelForDraft,
  promptForDraft,
  shownPrompt,
  startersShown,
  wearableSuggestionKeys,
  wearableSuggestions,
} from "./suggested-questions";
import { pendingTurn } from "./turn-updates";

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

describe("startersShown (#454)", () => {
  test("an empty list of turns offers the chips", () => {
    expect(startersShown([])).toBe(true);
  });

  test("the first turn takes them away from the moment it is pending", () => {
    const pending = pendingTurn("What was their latest heart rate?", [
      { id: "agent:auto", name: "Auto" },
    ]);
    expect(startersShown([pending])).toBe(false);
    expect(startersShown([{ ...pending, id: "turn-1", pending: false }])).toBe(false);
  });
});

describe("promptForDraft (#480)", () => {
  const chip = {
    label: "What was their latest HbA1c?",
    prompt:
      "For synthetic subject synthetic-subject-1, using LOINC 4548-4, what was their latest HbA1c?",
  };

  test("a picked chip sent unchanged sends its grounded prompt", () => {
    expect(promptForDraft("What was their latest HbA1c?", chip)).toBe(chip.prompt);
    expect(promptForDraft("  What was their latest HbA1c? ", chip)).toBe(chip.prompt);
  });

  test("a draft that adds to the chip's question keeps the grounding", () => {
    expect(promptForDraft("What was their latest HbA1c? And in 2020?", chip)).toBe(
      "For synthetic subject synthetic-subject-1, using LOINC 4548-4, what was their latest HbA1c? And in 2020?",
    );
  });

  test("a changed draft, or one no chip wrote, is sent as typed", () => {
    expect(promptForDraft("What was their HbA1c in 2020?", chip)).toBe(
      "What was their HbA1c in 2020?",
    );
    expect(promptForDraft("What was their latest HbA1c?", null)).toBe(
      "What was their latest HbA1c?",
    );
  });
});

describe("a sent starter shows its short text (#506)", () => {
  const chip = {
    label: "What was their latest HbA1c?",
    prompt:
      "For synthetic subject synthetic-subject-1, using LOINC 4548-4, what was their latest HbA1c?",
  };
  const models = [{ id: "qwen3:4b", name: "qwen3:4b" }];

  /** What the prompt bar sends for a draft: the model's prompt and the bubble's text. */
  const send = (draft: string, picked: typeof chip | null) => {
    const prompt = promptForDraft(draft, picked);
    const label = labelForDraft(draft, picked);
    return { prompt, label, turn: pendingTurn(prompt, models, null, null, null, label) };
  };

  test("a chip sent unchanged: the bubble shows the question, the model gets the prompt", () => {
    const sent = send(" What was their latest HbA1c? ", chip);
    expect(sent.prompt).toBe(chip.prompt);
    expect(sent.label).toBe(chip.label);
    expect(shownPrompt(sent.turn)).toBe(chip.label);
    expect(sent.turn.prompt).toBe(chip.prompt);
  });

  test("added text shows as typed and is sent after the grounded prompt", () => {
    const sent = send("What was their latest HbA1c? And in 2020?", chip);
    expect(sent.prompt).toBe(`${chip.prompt} And in 2020?`);
    expect(shownPrompt(sent.turn)).toBe("What was their latest HbA1c? And in 2020?");
  });

  test("a typed draft, or a chip whose prompt is its question, has no label", () => {
    expect(send("What was their HbA1c in 2020?", chip).label).toBeNull();
    expect(send("What was their latest HbA1c?", null).label).toBeNull();
    const own = { label: "What was my latest HRV?", prompt: "What was my latest HRV?" };
    const sent = send("What was my latest HRV? ", own);
    expect(sent.label).toBeNull();
    expect(shownPrompt(sent.turn)).toBe("What was my latest HRV?");
  });
});

import { describe, expect, test } from "bun:test";

import {
  canContinue,
  clampStep,
  EMPTY_ANSWERS,
  isLastStep,
  normaliseAnswers,
  onboardingReducer,
  type OnboardingState,
  stepLabel,
} from "./onboarding-steps";

const start: OnboardingState = { step: 0, answers: EMPTY_ANSWERS };

describe("onboarding steps", () => {
  test("Continue on the first step needs a role and a data choice", () => {
    expect(canContinue(start)).toBe(false);
    const withRole = onboardingReducer(start, { type: "toggle-role", role: "student" });
    expect(canContinue(withRole)).toBe(false);
    const ready = onboardingReducer(withRole, {
      type: "set-data-choice",
      choice: "demo",
    });
    expect(canContinue(ready)).toBe(true);
    expect(canContinue({ ...start, step: 1 })).toBe(true);
  });

  test("roles toggle and keep the catalogue order", () => {
    const one = onboardingReducer(start, { type: "toggle-role", role: "student" });
    const two = onboardingReducer(one, { type: "toggle-role", role: "researcher" });
    expect(two.answers.roles).toEqual(["researcher", "student"]);
    const back = onboardingReducer(two, { type: "toggle-role", role: "student" });
    expect(back.answers.roles).toEqual(["researcher"]);
  });

  test("next and back stay inside the five steps", () => {
    const moved = [1, 2, 3, 4, 5, 6].reduce<OnboardingState>(
      (state) => onboardingReducer(state, { type: "next" }),
      start,
    );
    expect(moved.step).toBe(4);
    expect(isLastStep(moved.step)).toBe(true);
    expect(onboardingReducer(start, { type: "back" }).step).toBe(0);
    expect(stepLabel(moved.step)).toBe("Step 5 of 5");
  });

  test("interest is capped and sources are cleaned", () => {
    const long = onboardingReducer(start, {
      type: "set-interest",
      interest: "a".repeat(600),
    });
    expect(long.answers.interest.length).toBe(500);
    const sources = onboardingReducer(start, {
      type: "set-disabled-sources",
      disabled: ["gbd", "gbd", "guidelines"],
    });
    expect(sources.answers.disabledSources).toEqual(["guidelines", "gbd"]);
  });

  test("stored rows are cleaned on read", () => {
    expect(
      normaliseAnswers({
        roles: ["student", "astronaut", "researcher"],
        dataChoice: "real",
        interest: null,
        disabledSources: ["pubmed", "gbd"],
        liveSources: ["uniprot", "ensembl"],
      }),
    ).toEqual({
      roles: ["researcher", "student"],
      dataChoice: null,
      interest: "",
      disabledSources: ["gbd"],
      liveSources: ["ensembl"],
    });
    expect(clampStep(9)).toBe(4);
    expect(clampStep(-2)).toBe(0);
    expect(clampStep(1.5)).toBe(0);
  });
});

describe("live public lookups in the first-run flow (#6)", () => {
  test("off by default, and a switch stores the cleaned list", () => {
    expect(normaliseAnswers({}).liveSources).toEqual([]);
    const state = onboardingReducer(
      { step: 2, answers: normaliseAnswers({}) },
      { type: "set-live-sources", enabled: ["ensembl", "pubmed", "ensembl"] },
    );
    expect(state).toEqual({
      step: 2,
      answers: { ...normaliseAnswers({}), liveSources: ["pubmed", "ensembl"] },
    });
  });
});

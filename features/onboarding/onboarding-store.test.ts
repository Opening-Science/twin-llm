import { describe, expect, test } from "bun:test";

import {
  EMPTY_ONBOARDING,
  loadOnboardingOrEmpty,
  needsOnboarding,
  type OnboardingUserState,
} from "./onboarding-store";

const needs = (state: OnboardingUserState | null) =>
  needsOnboarding("local", {
    findUserState: async () => state,
    logError: () => undefined,
  });

describe("needsOnboarding", () => {
  test("no profile and no thread: onboarding", async () => {
    expect(await needs({ completed: false, hasThread: false })).toBe(true);
  });

  test("no profile but a thread: an existing user, no onboarding", async () => {
    expect(await needs({ completed: false, hasThread: true })).toBe(false);
  });

  test("completed or skipped: no onboarding", async () => {
    expect(await needs({ completed: true, hasThread: false })).toBe(false);
  });

  test("no user row yet: onboarding", async () => {
    expect(await needs(null)).toBe(true);
  });

  test("a failed read never traps anyone on /start", async () => {
    const logged: string[] = [];
    const result = await needsOnboarding("local", {
      findUserState: async () => {
        throw new TypeError("relation does not exist");
      },
      logError: (message, name) => logged.push(`${message} ${name}`),
    });
    expect(result).toBe(false);
    expect(logged).toEqual(["[onboarding] could not read completion TypeError"]);
  });
});

describe("loadOnboardingOrEmpty", () => {
  test("a failed read opens a fresh flow and logs the error name only", async () => {
    const logged: string[] = [];
    const result = await loadOnboardingOrEmpty("user-1", {
      load: async () => {
        throw new RangeError('table "onboarding_profiles" does not exist');
      },
      logError: (message, name) => logged.push(`${message} ${name}`),
    });
    expect(result).toEqual({
      answers: {
        roles: [],
        dataChoice: null,
        interest: "",
        disabledSources: [],
        liveSources: [],
      },
      step: 0,
      completed: false,
    });
    expect(logged).toEqual(["[onboarding] could not read saved answers RangeError"]);
  });

  test("saved answers come back as stored; no user is a fresh flow", async () => {
    const saved = {
      answers: {
        roles: ["student"] as const,
        dataChoice: "demo" as const,
        interest: "HRV",
        disabledSources: ["gbd"] as const,
      },
      step: 3,
      completed: false,
    };
    expect(await loadOnboardingOrEmpty("user-1", { load: async () => saved })).toEqual(
      saved,
    );
    expect(await loadOnboardingOrEmpty(null)).toBe(EMPTY_ONBOARDING);
  });
});

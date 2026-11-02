import { describe, expect, test } from "bun:test";

import { GenomeIdsBlockedError } from "@/infrastructure/disclosure-ledger";
import { GENOME_IDS_BLOCKED_SENTENCE } from "@/infrastructure/free-text-check";

import {
  buildStarterPrompt,
  fallbackStarters,
  generateStarterQuestions,
  parseStarterQuestions,
  type StarterContext,
  type StarterGenerate,
} from "./starter-questions";

const context: StarterContext = {
  roles: ["self-tracker"],
  dataChoice: "own",
  interest: "sleep after hard training days",
  connected: ["Oura"],
};

const quietLog = () => {
  const calls: (readonly [string, string])[] = [];
  return {
    calls,
    logError: (message: string, name: string) => calls.push([message, name]),
  };
};

describe("fallback starters", () => {
  test("own data as a self-tracker", () => {
    expect(fallbackStarters({ roles: ["self-tracker"], dataChoice: "own" })).toEqual([
      "How has my sleep duration changed over the last two weeks?",
      "Is my HRV this week above or below my own recent baseline?",
      "Which of my linked metrics have gaps in the last month?",
    ]);
  });

  test("demo cohort with a clinician-researcher interleaves both lists", () => {
    expect(
      fallbackStarters({ roles: ["clinician-researcher"], dataChoice: "demo" }),
    ).toEqual([
      "Which subjects in the synthetic cohort have the most heart-rate observations?",
      "Which guideline passages describe how blood pressure is measured?",
      "How does resting heart rate trend for one synthetic subject over their records?",
    ]);
  });

  test("nothing picked reads as the demo cohort", () => {
    expect(fallbackStarters({ roles: [], dataChoice: null })).toEqual(
      fallbackStarters({ roles: ["researcher"], dataChoice: "demo" }),
    );
  });
});

describe("parseStarterQuestions", () => {
  test("strips numbering, bullets, quotes and reasoning blocks", () => {
    const text = [
      "<think>maybe ask about doses?</think>",
      "Here are three questions:",
      "1. How does my deep sleep change after long runs?",
      '- "Which nights had the lowest HRV this month?"',
      "**What does readiness measure?**",
      "Is this the fourth one?",
    ].join("\n");
    expect(parseStarterQuestions(text)).toEqual([
      "How does my deep sleep change after long runs?",
      "Which nights had the lowest HRV this month?",
      "What does readiness measure?",
    ]);
  });

  test("drops claim-like or medicine lines and keeps the rest", () => {
    expect(
      parseStarterQuestions(
        [
          "Which illness do you have based on my HRV?",
          "Could my symptoms explain the low readiness?",
          "What dose of melatonin fits my sleep?",
          "How regular is my bedtime across weekdays?",
        ].join("\n"),
      ),
    ).toEqual(["How regular is my bedtime across weekdays?"]);
  });
});

describe("generateStarterQuestions", () => {
  test("model questions, topped up from the fixed ones", async () => {
    const seen: string[] = [];
    const generate: StarterGenerate = async ({ prompt }) => {
      seen.push(prompt);
      return "How does my deep sleep change after long runs?\nWhat does readiness measure?";
    };
    const log = quietLog();
    const result = await generateStarterQuestions(context, {
      generate,
      timeoutMs: 1000,
      logError: log.logError,
    });
    expect(result).toEqual({
      source: "model",
      questions: [
        "How does my deep sleep change after long runs?",
        "What does readiness measure?",
        "How has my sleep duration changed over the last two weeks?",
      ],
    });
    expect(seen).toEqual([buildStarterPrompt(context)]);
    expect(seen[0]).toBe(
      [
        "Roles: Self-tracker",
        "Data: their own linked data",
        "Linked sources: Oura",
        "What they want to explore: sleep after hard training days",
      ].join("\n"),
    );
    expect(log.calls).toEqual([]);
  });

  test("a provider error falls back and logs only the error name", async () => {
    const log = quietLog();
    const result = await generateStarterQuestions(context, {
      generate: async () => {
        throw new TypeError("connect ECONNREFUSED 127.0.0.1:11434");
      },
      timeoutMs: 1000,
      logError: log.logError,
    });
    expect(result).toEqual({ source: "fallback", questions: fallbackStarters(context) });
    expect(log.calls).toEqual([["[onboarding] starter questions failed", "TypeError"]]);
  });

  test("a request blocked for genome identifiers falls back with the refusal (#414)", async () => {
    const log = quietLog();
    const result = await generateStarterQuestions(context, {
      generate: async () => {
        throw new GenomeIdsBlockedError();
      },
      timeoutMs: 1000,
      logError: log.logError,
    });
    expect(result).toEqual({
      source: "fallback",
      questions: fallbackStarters(context),
      notice: GENOME_IDS_BLOCKED_SENTENCE,
    });
    expect(log.calls).toEqual([
      [
        "[onboarding] starter questions blocked: genome identifiers",
        "GenomeIdsBlockedError",
      ],
    ]);
  });

  test("a slow model times out, is aborted and falls back", async () => {
    const log = quietLog();
    let aborted = false;
    const result = await generateStarterQuestions(context, {
      generate: ({ abortSignal }) =>
        new Promise<string>(() => {
          abortSignal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
      timeoutMs: 5,
      logError: log.logError,
    });
    expect(result).toEqual({ source: "fallback", questions: fallbackStarters(context) });
    expect(aborted).toBe(true);
    expect(log.calls).toEqual([
      ["[onboarding] starter questions timed out", "TimeoutError"],
    ]);
  });

  test("an answer with no usable question falls back", async () => {
    const log = quietLog();
    const result = await generateStarterQuestions(context, {
      generate: async () => "Sure! Here you go.",
      timeoutMs: 1000,
      logError: log.logError,
    });
    expect(result.source).toBe("fallback");
    expect(result.questions).toEqual(fallbackStarters(context));
    expect(log.calls).toEqual([
      ["[onboarding] starter questions were unusable", "EmptyResult"],
    ]);
  });
});

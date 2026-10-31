import { describe, expect, test } from "bun:test";

import type { ChatRequest } from "@/features/chat/chat-request";
import {
  type ChatProviderSettings,
  createStartAnswer,
} from "@/features/chat/start-answer";
import type { StreamContext } from "@/features/chat/stream-model-response";
import type { WearableContext } from "@/features/chat/wearable-context";
import type { CatalogModel } from "@/infrastructure/model-catalog";
import type { TurnSkill } from "@/infrastructure/skill-gate";
import type { AppendInput } from "@/packages/audit/append";

import { createScheduledTurn, type ScheduledTurnDeps } from "./scheduled-turn";
import type { TurnPlan } from "./turn-rules";

/**
 * Policy parity (#54): a scheduled run and a typed `/sleep` turn reach the
 * same `startAnswer` with the same request, so every permit port is called
 * the same way, in the same order, and the same audit rows are written.
 */

const ACTOR = "user_synthetic_1";
const APP_USER = "app-user-synthetic-1";
const TURN = "turn-synthetic-1";
const THREAD = "thread-synthetic-1";
const MODEL = "qwen3:4b";
const QUESTION = "How did synthetic person 1 sleep this week?";

const CATALOG: readonly CatalogModel[] = [
  {
    id: MODEL,
    name: "Qwen3 4B",
    provider: "Ollama",
    providerId: "ollama",
    contextTokens: 40_960,
  },
];

const SLEEP: TurnSkill = {
  name: "sleep",
  description: "Chart the last nights of sleep.",
  tools: ["coverage", "baseline_deviation"],
  sources: ["cohort-records", "cohort-analytics", "wearable-context"],
  providers: ["ollama"],
  views: ["chart.timeseries"],
  instructions: "Describe sleep.",
};

const NO_WEARABLES: WearableContext = {
  ouraSummary: null,
  whoopSummary: null,
  googleHealthSummary: null,
  vitronicSummary: null,
};

/** A recording `startAnswer`: every port call, audit row, stream and refusal, in order. */
const recordingStartAnswer = (settings: ChatProviderSettings) => {
  const calls: string[] = [];
  const audits: AppendInput[] = [];
  const streamed: (readonly [ChatRequest, StreamContext])[] = [];
  const refused = new Set<string>();
  const startAnswer = createStartAnswer({
    settings: () => {
      calls.push("settings");
      return settings;
    },
    chatIsLocal: () => {
      calls.push("chatIsLocal");
      return settings.provider === "ollama";
    },
    loadGenomeThread: async (turnId) => {
      calls.push(`genomeThread ${turnId}`);
      return { threadId: THREAD, usedGenome: false };
    },
    loadWearables: async (mode, appUserId) => {
      calls.push(`wearables ${mode} ${appUserId}`);
      return NO_WEARABLES;
    },
    loadDisabledSources: async (appUserId) => {
      calls.push(`disabledSources ${appUserId}`);
      return [];
    },
    findSkill: async (name, appUserId) => {
      calls.push(`findSkill ${name} ${appUserId}`);
      return name === SLEEP.name ? SLEEP : null;
    },
    loadTwinNotes: async (appUserId, turnId) => {
      calls.push(`twinNotes ${appUserId} ${turnId}`);
      return [];
    },
    appendAudit: async (input) => {
      calls.push(`audit ${input.tool}`);
      audits.push(input);
      return {};
    },
    stream: async (call, context) => {
      calls.push("stream");
      streamed.push([call, context]);
      return new Response("streamed");
    },
    markRefused: async (target) => {
      calls.push("refused");
      refused.add(target.turnId);
    },
  });
  return { startAnswer, calls, audits, streamed, refused };
};

/** The browser's request for `/sleep <question>` in a saved thread. */
const TYPED_CALL: ChatRequest = {
  modelId: MODEL,
  turnId: TURN,
  messages: [{ role: "user", content: QUESTION }],
  skill: "sleep",
};

const scheduledDeps = (
  recorder: ReturnType<typeof recordingStartAnswer>,
  plans: TurnPlan[],
): ScheduledTurnDeps => ({
  provider: () => "ollama",
  catalog: async () => CATALOG,
  writeTurn: async (_owner, threadId, plan, options) => {
    plans.push(plan);
    expect(options).toEqual({ scheduled: true });
    return {
      ok: true,
      threadId: threadId ?? THREAD,
      threadTitle: plan.title,
      turnId: TURN,
      responses: [{ id: "row-1", modelId: MODEL, modelName: "Qwen3 4B" }],
    };
  },
  startAnswer: recorder.startAnswer,
  markFailed: async () => undefined,
  answerStatus: async (turnId) => (recorder.refused.has(turnId) ? "REFUSED" : "COMPLETE"),
  logError: () => undefined,
});

const INPUT = {
  actorId: ACTOR,
  appUserId: APP_USER,
  threadId: THREAD,
  skill: "sleep",
  question: QUESTION,
  modelId: MODEL,
} as const;

describe("scheduled turn policy parity", () => {
  const cases: readonly Readonly<{ name: string; settings: ChatProviderSettings }>[] = [
    {
      name: "synthetic on ollama",
      settings: {
        dataMode: "synthetic",
        provider: "ollama",
        exoscalePersonalData: "off",
      },
    },
    {
      name: "personal on ollama",
      settings: { dataMode: "personal", provider: "ollama", exoscalePersonalData: "off" },
    },
    {
      name: "personal on exoscale without the pilot (skill refuses)",
      settings: {
        dataMode: "personal",
        provider: "exoscale",
        exoscalePersonalData: "off",
      },
    },
    {
      name: "personal on openrouter (refused)",
      settings: {
        dataMode: "personal",
        provider: "openrouter",
        exoscalePersonalData: "off",
      },
    },
  ];

  for (const { name, settings } of cases) {
    test(`${name}: same permit calls, audit rows and stream as a typed turn`, async () => {
      const typed = recordingStartAnswer(settings);
      await typed.startAnswer(ACTOR, APP_USER, TYPED_CALL, null);

      const scheduled = recordingStartAnswer(settings);
      const plans: TurnPlan[] = [];
      const outcome = await createScheduledTurn(scheduledDeps(scheduled, plans))(INPUT);

      expect(scheduled.calls).toEqual(typed.calls);
      expect(scheduled.audits).toEqual(typed.audits);
      expect(scheduled.streamed).toEqual(typed.streamed);
      expect([...scheduled.refused]).toEqual([...typed.refused]);
      expect(outcome).toEqual({
        status: typed.refused.size > 0 ? "refused" : "complete",
        turnId: TURN,
        threadId: THREAD,
      });
      expect(plans.map((plan) => plan.prompt)).toEqual([QUESTION]);
    });
  }

  test("the request it sends is the browser's request, field for field", async () => {
    const recorder = recordingStartAnswer({
      dataMode: "synthetic",
      provider: "ollama",
      exoscalePersonalData: "off",
    });
    await createScheduledTurn(scheduledDeps(recorder, []))(INPUT);
    expect(recorder.streamed.map(([call]) => call)).toEqual([TYPED_CALL]);
    expect(recorder.calls).toContain("audit skill.sleep");
  });

  test("a model the catalog no longer offers fails before any row or permit", async () => {
    const recorder = recordingStartAnswer({
      dataMode: "synthetic",
      provider: "ollama",
      exoscalePersonalData: "off",
    });
    const plans: TurnPlan[] = [];
    const outcome = await createScheduledTurn(scheduledDeps(recorder, plans))({
      ...INPUT,
      modelId: "gone:1b",
    });
    expect(outcome).toEqual({ status: "failed", turnId: null, threadId: THREAD });
    expect(plans).toEqual([]);
    expect(recorder.calls).toEqual([]);
  });

  test("a stream that throws marks the answer failed", async () => {
    const marked: string[] = [];
    const outcome = await createScheduledTurn({
      ...scheduledDeps(
        recordingStartAnswer({
          dataMode: "synthetic",
          provider: "ollama",
          exoscalePersonalData: "off",
        }),
        [],
      ),
      startAnswer: async () => {
        throw new Error("provider down");
      },
      markFailed: async ({ turnId }) => {
        marked.push(turnId);
      },
      answerStatus: async () => "FAILED",
    })(INPUT);
    expect(marked).toEqual([TURN]);
    expect(outcome).toEqual({ status: "failed", turnId: TURN, threadId: THREAD });
  });
});

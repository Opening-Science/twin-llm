import { describe, expect, test } from "bun:test";

import type { ChatRequest } from "@/features/chat/chat-request";
import type { CatalogModel } from "@/infrastructure/model-catalog";
import type { AppendInput } from "@/packages/audit/append";

import { createScheduledTurn, type ScheduledTurnDeps } from "./scheduled-turn";
import { createSuggestionsHandler, type SuggestionsDeps } from "./suggestions-handler";
import {
  cohortSuggestions,
  MAX_SUGGESTIONS,
  NO_SUGGESTIONS,
  requestedSubject,
  wearableSuggestions,
} from "./suggestions";
import { createThreadDeleteHandler } from "./thread-delete-handler";

describe("deleting a thread (SERVER-SPEC 3.8)", () => {
  const run = (deleted: number | null, actor: string | null = "actor-1") => {
    const audit: AppendInput[] = [];
    const handler = createThreadDeleteHandler({
      actorId: async () => actor,
      appUserIdFor: async () => "user-1",
      deleteOwnedThread: async () => deleted,
      appendAudit: async (input) => {
        audit.push(input);
      },
    });
    return { audit, handler };
  };

  test("the owner's thread: deleted, audited with ids and a count", async () => {
    const { audit, handler } = run(3);
    const response = await handler("thread-1");
    expect(await response.json()).toEqual({ ok: true, turnsDeleted: 3 });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(audit).toEqual([
      {
        actor: "actor-1",
        sessionId: "thread-1",
        subjectRef: null,
        tool: "thread.delete",
        args: { threadId: "thread-1" },
        result: { turnsDeleted: 3 },
        rowCount: 3,
      },
    ]);
  });

  test("someone else's, unknown or signed out: the same 404, no audit row", async () => {
    for (const { audit, handler } of [run(null), run(2, null)]) {
      const response = await handler("thread-1");
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
      expect(audit).toEqual([]);
    }
  });
});

describe("suggested questions (SERVER-SPEC 3.9)", () => {
  test("synthetic: busiest first, trend from 3 readings, labs latest only, chart last", () => {
    const chips = cohortSuggestions({ ref: "29bbf012", label: "Synthetic person 1" }, [
      { loinc: "8867-4", n: 40 },
      { loinc: "4548-4", n: 6 },
      { loinc: "29463-7", n: 2 },
    ]);
    expect(chips.heading).toBe("From Synthetic person 1, synthetic");
    expect(chips.questions.map((chip) => chip.label)).toEqual([
      "How has their heart rate changed over time?",
      "What is their latest HbA1c?",
      "What is their latest body weight?",
      "Show their heart rate as a chart.",
    ]);
    expect(chips.questions[0]?.prompt).toBe(
      "For synthetic subject 29bbf012, using LOINC 8867-4, how has their heart rate changed over time?",
    );
  });

  test("at most five chips; nothing with no rows", () => {
    const many = cohortSuggestions(
      { ref: "r", label: "Synthetic person 1" },
      ["8867-4", "8480-6", "29463-7", "39156-5", "4548-4", "2339-0", "9279-1"].map(
        (loinc, index) => ({ loinc, n: 20 - index }),
      ),
    );
    expect(many.questions.length).toBe(MAX_SUGGESTIONS);
    expect(cohortSuggestions({ ref: "r", label: "x" }, [])).toEqual(NO_SUGGESTIONS);
  });

  test("personal: the prompt is the label and trends carry the day count", () => {
    const chips = wearableSuggestions([
      { key: "oura.sleep.total_hours", days_with_data: 30 },
      { key: "oura.readiness.score", days_with_data: 2 },
    ]);
    expect(chips.heading).toBe("From your linked wearables");
    expect(chips.questions[0]).toEqual({
      label: "How has my sleep changed over the last 30 days?",
      prompt: "How has my sleep changed over the last 30 days?",
    });
    expect(chips.questions.map((chip) => chip.label)).toContain(
      "What was my latest readiness score?",
    );
  });

  test("the subject parameter counts only as a UUID", () => {
    expect(requestedSubject("29BBF012-0000-4000-8000-000000000000")).toBe(
      "29bbf012-0000-4000-8000-000000000000",
    );
    expect(requestedSubject("../etc")).toBeNull();
    expect(requestedSubject(null)).toBeNull();
  });

  const deps = (over: Partial<SuggestionsDeps> = {}): SuggestionsDeps => ({
    resolveActorId: async () => "actor-1",
    dataMode: () => "synthetic",
    findSubject: async () => ({ ref: "29bbf012", label: "Synthetic person 1" }),
    cohortCoverage: async () => ({
      start: "1900-01-01",
      end: "2026-11-14",
      days_in_window: 1,
      codes: [
        {
          loinc: "8867-4",
          unit: "/min",
          n: 12,
          days_with_data: 12,
          coverage_ratio: 1,
          longest_gap_days: 0,
        },
      ],
    }),
    loadWearables: async () => null,
    wearableCoverage: async () => {
      throw new Error("not in synthetic mode");
    },
    today: () => "2026-11-14",
    logError: () => undefined,
    ...over,
  });
  const ask = (handler: (request: Request) => Promise<Response>) =>
    handler(new Request("http://localhost/api/chat/suggestions"));

  test("signed out or a refused read: 200 empty; a thrown error: 502 empty", async () => {
    const out = await ask(
      createSuggestionsHandler(deps({ resolveActorId: async () => null })),
    );
    expect(await out.json()).toEqual(NO_SUGGESTIONS);
    const refused = await ask(
      createSuggestionsHandler(
        deps({ cohortCoverage: async () => ({ code: "ROW_CAP_EXCEEDED", error: "x" }) }),
      ),
    );
    expect(await refused.json()).toEqual(NO_SUGGESTIONS);
    const thrown = await ask(
      createSuggestionsHandler(
        deps({
          findSubject: async () => {
            throw new Error("db");
          },
        }),
      ),
    );
    expect(thrown.status).toBe(502);
    expect(await thrown.json()).toEqual(NO_SUGGESTIONS);
    expect(thrown.headers.get("cache-control")).toBe("no-store");
  });

  test("a synthetic read answers chips about the subject", async () => {
    const response = await ask(createSuggestionsHandler(deps()));
    const body = (await response.json()) as { questions: unknown[] };
    expect(body.questions.length).toBe(2);
  });
});

const CATALOG: readonly CatalogModel[] = [
  {
    id: "qwen3:4b",
    name: "Qwen3 4B",
    provider: "Ollama",
    providerId: "ollama",
    contextTokens: 32_000,
  },
];

describe("a scheduled turn (SERVER-SPEC 3.5)", () => {
  const scheduled = (over: Partial<ScheduledTurnDeps> = {}) => {
    const calls: string[] = [];
    const sent: ChatRequest[] = [];
    const run = createScheduledTurn({
      catalog: async () => CATALOG,
      provider: () => "ollama",
      writeTurn: async ({ scheduled: mark, plan }) => {
        calls.push(`write scheduled=${String(mark)} ${plan.prompt}`);
        return {
          ok: true,
          threadId: "thread-1",
          threadTitle: "t",
          turnId: "turn-1",
          responses: [{ id: "r1", modelId: "qwen3:4b", modelName: "Qwen3 4B" }],
        };
      },
      startAnswer: async (_actor, _user, call) => {
        sent.push(call);
        return new Response("data: {}\n\n");
      },
      markFailed: async () => {
        calls.push("failed");
      },
      storedStatus: async () => "COMPLETE",
      logError: () => undefined,
      ...over,
    });
    return { calls, sent, run };
  };
  const INPUT = {
    actorId: "actor-1",
    appUserId: "user-1",
    threadId: null,
    skill: "sleep",
    question: "  How did I sleep?  ",
    modelId: "qwen3:4b",
  };

  test("writes a scheduled turn and sends the browser's request shape", async () => {
    const { calls, sent, run } = scheduled();
    expect(await run(INPUT)).toEqual({
      status: "complete",
      turnId: "turn-1",
      threadId: "thread-1",
    });
    expect(calls).toEqual(["write scheduled=true How did I sleep?"]);
    expect(sent).toEqual([
      {
        modelId: "qwen3:4b",
        turnId: "turn-1",
        messages: [{ role: "user", content: "How did I sleep?" }],
        skill: "sleep",
      },
    ]);
  });

  test("a refused plan writes nothing and asks no permit", async () => {
    const { calls, sent, run } = scheduled({ catalog: async () => null });
    expect(await run({ ...INPUT, threadId: "thread-9" })).toEqual({
      status: "failed",
      turnId: null,
      threadId: "thread-9",
    });
    expect(calls).toEqual([]);
    expect(sent).toEqual([]);
  });

  test("a start that throws marks the row failed; stored statuses map to outcomes", async () => {
    const thrown = scheduled({
      startAnswer: async () => {
        throw new Error("down");
      },
      storedStatus: async () => "FAILED",
    });
    expect((await thrown.run(INPUT)).status).toBe("failed");
    expect(thrown.calls.at(-1)).toBe("failed");
    expect(
      (await scheduled({ storedStatus: async () => "REFUSED" }).run(INPUT)).status,
    ).toBe("refused");
    expect(
      (await scheduled({ storedStatus: async () => "STOPPED" }).run(INPUT)).status,
    ).toBe("failed");
  });
});

import { describe, expect, test } from "bun:test";

import { MockLanguageModelV4 } from "ai/test";

import {
  INCOGNITO_LOCAL_ONLY,
  INCOGNITO_LOCAL_ONLY_SENTENCE,
} from "@/infrastructure/incognito";
import { withAgents } from "@/infrastructure/model-catalog";
import type { AppendInput } from "@/packages/audit/append";
import type { QueryToolPorts } from "@/packages/query-tools/ports";

import type { ResponseToolCall } from "./response/document-v1";
import {
  createIncognitoChatHandler,
  INCOGNITO_ANALYTICS,
  INCOGNITO_ANSWER_STORE,
  type IncognitoChatDeps,
} from "./incognito-chat";

/**
 * `POST /api/chat/incognito` with every outside effect replaced by a fake that
 * records what reached it, synthetic data only. The fake database below has
 * the tables a saved chat writes (threads, turns, model_responses) and the
 * audit chain; every port the handler is given goes through it.
 */

const ACTOR = "user_synthetic_incognito";
const APP_USER = "app-user-synthetic-incognito";
const MODEL = "llama3.2";
const PROMPT = "Convert a synthetic glucose reading of 90 mg/dL to mmol/L.";
const ANSWER =
  "## Reasoning\nConverted one value.\n\n## Evidence Used\n- convert_unit\n\n## Answer\nAbout 5 mmol/L.\n\n## Uncertainty\nRounded.";
const RANDOM = "0f3c2a51-5b7e-4d0e-9c1a-2b6f4e8d7a10";

type Write = Readonly<{ table: string; op: string }>;

/** A database that only records: what was read, what was written. */
const fakeDatabase = () => {
  const reads: string[] = [];
  const writes: Write[] = [];
  const audits: AppendInput[] = [];
  return {
    reads,
    writes,
    audits,
    appendAudit: async (input: AppendInput) => {
      writes.push({ table: "audit_events", op: "create" });
      audits.push(input);
      return undefined;
    },
    loadAudit: async (sessionId: string): Promise<readonly ResponseToolCall[]> => {
      reads.push(`audit_events ${sessionId}`);
      return audits
        .filter((row) => row.sessionId === sessionId)
        .map((row, index) => ({
          seq: index + 1,
          tool: row.tool,
          args_sha256: "a".repeat(64),
          result_sha256: "b".repeat(64),
          row_count: row.rowCount,
          ts: "2026-10-27T08:00:00.000Z",
        }));
    },
  };
};

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

const streamOf = (parts: readonly Record<string, unknown>[]) => ({
  stream: new ReadableStream({
    start: (controller) => {
      parts.forEach((part) => controller.enqueue(part as never));
      controller.close();
    },
  }),
});

/** First step: one `convert_unit` call. Second step: the answer. */
const localModel = () => {
  const steps = [
    [
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "convert_unit",
        input: JSON.stringify({
          value: 90,
          from: "mg/dL",
          to: "mmol/L",
          analyte: "glucose",
        }),
      },
      {
        type: "finish",
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage,
      },
    ],
    [
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: ANSWER },
      { type: "text-end", id: "t" },
      { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
    ],
  ];
  const calls = { count: 0 };
  return new MockLanguageModelV4({
    doStream: async () => streamOf(steps[Math.min(calls.count++, 1)] ?? []),
  });
};

const harness = (
  options: Readonly<{ chatIsLocal?: boolean; signedIn?: boolean; agents?: boolean }> = {},
) => {
  const db = fakeDatabase();
  const model = localModel();
  const resolved: string[] = [];
  const catalogReads: string[] = [];
  const query: QueryToolPorts = {
    findSubject: async () => {
      db.reads.push("subjects");
      return null;
    },
    findObservations: async () => {
      db.reads.push("observations");
      return [];
    },
    findCohortObservations: async () => {
      db.reads.push("observations");
      return [];
    },
    appendAudit: db.appendAudit,
  };
  const deps: IncognitoChatDeps = {
    resolveActorId: async () => (options.signedIn === false ? null : ACTOR),
    guard: async () => null,
    catalog: async () => {
      catalogReads.push("catalog");
      return options.agents === true
        ? withAgents(
            [
              {
                id: MODEL,
                name: MODEL,
                provider: "Ollama",
                providerId: "ollama",
                contextTokens: 16_384,
              },
            ],
            { provider: "ollama", chatIsLocal: true, skills: [] },
          )
        : [{ id: MODEL }];
    },
    chatIsLocal: () => options.chatIsLocal ?? true,
    findAppUserId: async (actorId) => {
      db.reads.push(`users ${actorId}`);
      return APP_USER;
    },
    settings: () => ({
      dataMode: "synthetic",
      provider: options.chatIsLocal === false ? "exoscale" : "ollama",
      exoscalePersonalData: "off",
    }),
    loadWearables: async (mode, appUserId) => {
      db.reads.push(`wearables ${mode} ${appUserId}`);
      return {
        ouraSummary: null,
        whoopSummary: null,
        googleHealthSummary: null,
        vitronicSummary: null,
      };
    },
    loadDisabledSources: async (appUserId) => {
      db.reads.push(`disabled sources ${appUserId}`);
      return [];
    },
    appendAudit: db.appendAudit,
    findSkill: async () => null,
    randomId: () => RANDOM,
    pipeline: {
      resolveModel: (modelId) => {
        resolved.push(modelId);
        return model;
      },
      genomeTools: () => undefined,
      loadAudit: db.loadAudit,
      query,
    },
  };
  return { db, model, resolved, catalogReads, handle: createIncognitoChatHandler(deps) };
};

const post = (body: unknown): Request =>
  new Request("http://127.0.0.1/api/chat/incognito", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const BODY = { modelId: MODEL, messages: [{ role: "user", content: PROMPT }] };

describe("POST /api/chat/incognito", () => {
  test("a hosted chat model is refused with the code, and no model is called", async () => {
    const run = harness({ chatIsLocal: false });
    const response = await run.handle(post(BODY));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: INCOGNITO_LOCAL_ONLY,
      error: INCOGNITO_LOCAL_ONLY_SENTENCE,
    });
    expect(run.resolved).toEqual([]);
    expect(run.model.doStreamCalls.length).toBe(0);
    expect(run.catalogReads).toEqual([]);
    expect(run.db.writes).toEqual([]);
    expect(run.db.reads).toEqual([]);
  });

  test("a signed-out caller gets 401 and nothing else happens", async () => {
    const run = harness({ signedIn: false });
    const response = await run.handle(post(BODY));
    expect(response.status).toBe(401);
    expect(run.resolved).toEqual([]);
    expect(run.db.reads).toEqual([]);
  });

  test("the body is closed: a turn id or any other extra field is refused", async () => {
    const run = harness();
    const withTurn = await run.handle(post({ ...BODY, turnId: "turn-synthetic-1" }));
    const extraMessageField = await run.handle(
      post({ modelId: MODEL, messages: [{ role: "user", content: PROMPT, id: "m1" }] }),
    );
    expect([withTurn.status, extraMessageField.status]).toEqual([400, 400]);
    expect(run.resolved).toEqual([]);
  });

  test("a history longer than 100 messages is refused", async () => {
    const run = harness();
    const messages = Array.from({ length: 101 }, () => ({ role: "user", content: "x" }));
    const response = await run.handle(post({ modelId: MODEL, messages }));
    expect(response.status).toBe(400);
    expect(run.resolved).toEqual([]);
  });

  test("a model the provider does not offer is refused before any model call", async () => {
    const run = harness();
    const response = await run.handle(post({ ...BODY, modelId: "not-offered" }));
    expect(response.status).toBe(400);
    expect(run.resolved).toEqual([]);
  });

  test("a local model streams the answer and nothing but audit rows is written", async () => {
    const run = harness();
    const response = await run.handle(post(BODY));
    expect(response.status).toBe(200);
    const streamed = await response.text();

    expect(streamed).toContain("About 5 mmol/L.");
    expect(run.resolved).toEqual([MODEL]);
    expect(run.model.doStreamCalls.length).toBe(2);
    // Reads only, and the audit chain: no thread, turn or model response row.
    expect(run.db.writes).toEqual([{ table: "audit_events", op: "create" }]);
    expect(run.db.writes.filter(({ table }) => table !== "audit_events")).toEqual([]);
    expect(run.db.reads).toEqual([
      `users ${ACTOR}`,
      `wearables synthetic ${APP_USER}`,
      `disabled sources ${APP_USER}`,
      `audit_events incognito-${RANDOM}`,
    ]);
  });

  test("audit rows use a random session id and carry no prompt or answer text", async () => {
    const run = harness();
    await (await run.handle(post(BODY))).text();

    expect(
      run.db.audits.map(({ actor, sessionId, subjectRef, tool, rowCount }) => ({
        actor,
        sessionId,
        subjectRef,
        tool,
        rowCount,
      })),
    ).toEqual([
      {
        actor: ACTOR,
        sessionId: `incognito-${RANDOM}`,
        subjectRef: null,
        tool: "convert_unit",
        rowCount: 0,
      },
    ]);
    const recorded = JSON.stringify(run.db.audits);
    expect(recorded.includes(PROMPT)).toBe(false);
    expect(recorded.includes("About 5 mmol/L.")).toBe(false);
    expect(recorded.includes("turn-")).toBe(false);
  });
});

describe("POST /api/chat/incognito with an agent (#218)", () => {
  test("agent:gp runs on its base model with its role line in the system prompt", async () => {
    const run = harness({ agents: true });
    const response = await run.handle(post({ ...BODY, modelId: "agent:gp" }));
    expect(response.status).toBe(200);
    await response.text();
    expect(run.resolved).toEqual([MODEL]);
    const [first] = run.model.doStreamCalls;
    const system = first?.prompt.find((message) => message.role === "system");
    const lines = typeof system?.content === "string" ? system.content.split("\n") : [];
    expect(lines.slice(0, 2)).toEqual([
      "You are TwinLLM, a research assistant for personalized-medicine questions.",
      "Agent: General Practitioner. Looks at the whole record and says when a question is better asked of one of the specialist agents.",
    ]);
  });

  test("an agent the catalog does not offer is refused before any model call", async () => {
    const run = harness();
    const response = await run.handle(post({ ...BODY, modelId: "agent:gp" }));
    expect(response.status).toBe(400);
    expect(run.resolved).toEqual([]);
  });
});

describe("the incognito store and analytics", () => {
  test("keep nothing and send nothing", async () => {
    expect(await INCOGNITO_ANSWER_STORE.loadViews("incognito-x")).toEqual([]);
    expect(
      await INCOGNITO_ANSWER_STORE.writeFailed({ turnId: "incognito-x", modelId: MODEL }),
    ).toBeUndefined();
    expect(
      INCOGNITO_ANALYTICS.answered({
        clerkId: ACTOR,
        turnId: "incognito-x",
        modelId: MODEL,
        status: "COMPLETE",
      }),
    ).toBeUndefined();
    expect(Object.isFrozen(INCOGNITO_ANSWER_STORE)).toBe(true);
    expect(Object.isFrozen(INCOGNITO_ANALYTICS)).toBe(true);
  });
});

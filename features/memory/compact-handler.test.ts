import { describe, expect, test } from "bun:test";

import {
  NOTE_DRAFT_REFUSED,
  type NoteTurn,
  VALUE_LEFT_OUT,
} from "@/infrastructure/twin-notes";
import type { AppendInput } from "@/packages/audit/append";

import { GenomeIdsBlockedError } from "@/infrastructure/disclosure-ledger";
import { GENOME_IDS_BLOCKED_SENTENCE } from "@/infrastructure/free-text-check";

import { measureLines } from "./compact-draft";
import {
  COMPACT_COPY,
  type CompactDeps,
  createCompactHandler,
  typedInThread,
} from "./compact-handler";
import { SYNTHETIC_THREAD } from "./fixtures";

const ACTOR = "user_synthetic_1";

const request = (body: unknown): Request =>
  new Request("http://localhost/api/memory/compact", {
    method: "POST",
    body: JSON.stringify(body),
  });

const SYNTHETIC_TURN: NoteTurn = {
  mode: "synthetic",
  provider: "ollama",
  exoscalePersonalData: "off",
  chatIsLocal: true,
};

const harness = (
  overrides: Partial<CompactDeps> &
    Readonly<{ reply?: string; auditFails?: boolean }> = {},
) => {
  const audits: AppendInput[] = [];
  const prompts: string[] = [];
  const errors: string[] = [];
  const deps: CompactDeps = {
    resolveActorId: async () => ACTOR,
    loadOwnedThread: async (id) => (id === SYNTHETIC_THREAD.id ? SYNTHETIC_THREAD : null),
    threadIsLocal: async () => false,
    turn: () => SYNTHETIC_TURN,
    draftModel: async (source) => ({
      modelId: source.modelId,
      generate: async ({ prompt }) => {
        prompts.push(prompt);
        return (
          overrides.reply ??
          '{"topics": ["Heart rate fell to 72.5 bpm"], "open_questions": ["Sleep rows"]}'
        );
      },
    }),
    providerEvent: () => null,
    appendAudit: async (input) => {
      if (overrides.auditFails) throw new Error("audit down");
      audits.push(input);
      return {};
    },
    logError: (message) => {
      errors.push(message);
    },
    ...overrides,
  };
  return { handle: createCompactHandler(deps), audits, prompts, errors };
};

describe("POST /api/memory/compact", () => {
  test("a synthetic thread gets a draft, audited before the model runs", async () => {
    const { handle, audits, prompts } = harness();
    const response = await handle(request({ threadId: SYNTHETIC_THREAD.id }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      draft: {
        title: "How did heart rate change in spring 2026? · subject 29bbf0",
        topics: [`Heart rate fell to ${VALUE_LEFT_OUT} bpm`],
        measures: [...measureLines(SYNTHETIC_THREAD)],
        openQuestions: ["Sleep rows"],
      },
      permit: "synthetic",
    });
    expect(audits).toEqual([
      {
        actor: ACTOR,
        sessionId: SYNTHETIC_THREAD.id,
        subjectRef: null,
        tool: "memory.note.draft",
        args: { threadId: SYNTHETIC_THREAD.id },
        result: { count: 2 },
        rowCount: 2,
      },
    ]);
    expect(prompts.length).toBe(1);
  });

  test("signed out, malformed, someone else's thread, nothing answered", async () => {
    const signedOut = harness({ resolveActorId: async () => null });
    expect((await signedOut.handle(request({ threadId: "x" }))).status).toBe(401);

    const malformed = harness();
    expect((await malformed.handle(request({ id: 1 }))).status).toBe(400);

    const other = harness();
    const response = await other.handle(request({ threadId: "thread-of-someone-else" }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: COMPACT_COPY.notFound });
    expect(other.audits).toEqual([]);
    expect(other.prompts).toEqual([]);

    const empty = harness({
      loadOwnedThread: async () => ({
        ...SYNTHETIC_THREAD,
        turns: [{ id: "t", prompt: "Hi", answers: [] }],
      }),
    });
    const emptyResponse = await empty.handle(request({ threadId: SYNTHETIC_THREAD.id }));
    expect(emptyResponse.status).toBe(400);
    expect(await emptyResponse.json()).toEqual({ error: COMPACT_COPY.empty });
  });

  test("a personal thread is never drafted by a third-party model", async () => {
    const { handle, audits, prompts } = harness({
      turn: () => ({ ...SYNTHETIC_TURN, mode: "personal", provider: "openrouter" }),
    });
    const response = await handle(request({ threadId: SYNTHETIC_THREAD.id }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: NOTE_DRAFT_REFUSED });
    expect(audits).toEqual([]);
    expect(prompts).toEqual([]);
  });

  test("a genome or imported-data thread is drafted only on this machine", async () => {
    const pilot = harness({
      threadIsLocal: async () => true,
      turn: () => ({
        mode: "personal",
        provider: "exoscale",
        exoscalePersonalData: "consented-pilot",
        chatIsLocal: false,
      }),
    });
    expect((await pilot.handle(request({ threadId: SYNTHETIC_THREAD.id }))).status).toBe(
      403,
    );
    expect(pilot.prompts).toEqual([]);

    const local = harness({
      threadIsLocal: async () => true,
      turn: () => ({ ...SYNTHETIC_TURN, mode: "personal" }),
    });
    const response = await local.handle(request({ threadId: SYNTHETIC_THREAD.id }));
    expect(response.status).toBe(200);
    expect(Reflect.get(Object(await response.json()), "permit")).toBe("local");
  });

  test("a personal draft to the Exoscale pilot writes the provider row first", async () => {
    const { handle, audits } = harness({
      turn: () => ({
        mode: "personal",
        provider: "exoscale",
        exoscalePersonalData: "consented-pilot",
        chatIsLocal: false,
      }),
      providerEvent: (actor, sessionId, modelId) => ({
        actor,
        sessionId,
        subjectRef: null,
        tool: "provider.personal_data_sent",
        args: { provider: "exoscale", modelId },
        result: { sent: true },
        rowCount: 0,
      }),
    });
    expect((await handle(request({ threadId: SYNTHETIC_THREAD.id }))).status).toBe(200);
    expect(audits.map((row) => row.tool)).toEqual([
      "provider.personal_data_sent",
      "memory.note.draft",
    ]);
  });

  test("a model no longer offered drafts nothing", async () => {
    const { handle, audits } = harness({ draftModel: async () => null });
    const response = await handle(request({ threadId: SYNTHETIC_THREAD.id }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: COMPACT_COPY.modelGone });
    expect(audits).toEqual([]);
  });

  test("when the audit row cannot be written the model is not called", async () => {
    const { handle, prompts } = harness({ auditFails: true });
    const response = await handle(request({ threadId: SYNTHETIC_THREAD.id }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: COMPACT_COPY.failed });
    expect(prompts).toEqual([]);
  });

  test("an unusable reply or a failed model still gives the person's questions", async () => {
    const odd = harness({ reply: "Sure! Here is a summary." });
    const body = Object(
      await (await odd.handle(request({ threadId: SYNTHETIC_THREAD.id }))).json(),
    );
    expect(Reflect.get(body, "notice")).toBe(COMPACT_COPY.noReply);
    expect(Reflect.get(Reflect.get(body, "draft"), "topics")).toEqual([
      "How did heart rate change for synthetic subject 29bbf012 in spring 2026?",
      "And sleep?",
    ]);

    const failing = harness({
      draftModel: async () => ({
        modelId: "qwen3:4b",
        generate: async () => {
          throw new Error("provider said something private");
        },
      }),
    });
    const response = await failing.handle(request({ threadId: SYNTHETIC_THREAD.id }));
    expect(response.status).toBe(200);
    expect(failing.errors).toEqual(["[memory] the draft model failed"]);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });

  test("the model is given the thread's questions as what the person typed (#414)", async () => {
    const typedSeen: (readonly string[])[] = [];
    const { handle } = harness({
      draftModel: async (source, _disclosure, typed) => {
        typedSeen.push(typed);
        return {
          modelId: source.modelId,
          generate: async () => '{"topics": ["Heart rate"], "open_questions": []}',
        };
      },
    });
    await handle(request({ threadId: SYNTHETIC_THREAD.id }));
    expect(typedSeen).toEqual([
      [
        "How did heart rate change for synthetic subject 29bbf012 in spring 2026?",
        "And sleep?",
      ],
    ]);
  });

  test("a request blocked for genome identifiers shows the refusal, not a model error (#414)", async () => {
    const blocked = harness({
      draftModel: async () => ({
        modelId: "synthetic-hosted",
        generate: async () => {
          throw new Error("retry gave up", { cause: new GenomeIdsBlockedError() });
        },
      }),
    });
    const response = await blocked.handle(request({ threadId: SYNTHETIC_THREAD.id }));
    expect(response.status).toBe(200);
    const body = Object(await response.json());
    expect(Reflect.get(body, "notice")).toBe(GENOME_IDS_BLOCKED_SENTENCE);
    expect(Reflect.get(Reflect.get(body, "draft"), "topics")).toEqual([
      "How did heart rate change for synthetic subject 29bbf012 in spring 2026?",
      "And sleep?",
    ]);
    expect(blocked.errors).toEqual([
      "[memory] the draft request was blocked: genome identifiers",
    ]);
  });
});

describe("typedInThread", () => {
  test("is the person's questions, never the answers", () => {
    expect(typedInThread(SYNTHETIC_THREAD)).toEqual(
      SYNTHETIC_THREAD.turns.map((turn) => turn.prompt),
    );
    expect(typedInThread({ ...SYNTHETIC_THREAD, turns: [] })).toEqual([]);
  });
});

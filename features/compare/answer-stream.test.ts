import { describe, expect, test } from "bun:test";

import { chatResponseMetadata } from "@/features/chat/response-document";
import {
  PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
  PROVIDER_NOT_PERMITTED_SENTENCE,
} from "@/infrastructure/data-mode-policy";
import { GENOME_IDS_BLOCKED_SENTENCE } from "@/infrastructure/free-text-check";
import {
  GENOME_THREAD_LOCAL_ONLY,
  GENOME_THREAD_SENTENCE,
} from "@/infrastructure/genome-thread-policy";
import {
  INCOGNITO_LOCAL_ONLY,
  INCOGNITO_LOCAL_ONLY_SENTENCE,
} from "@/infrastructure/incognito";
import { NUMBER_REVIEW_PART } from "@/infrastructure/number-review";
import { SKILL_NOT_OFFERED, skillNotOffered } from "@/infrastructure/skill-gate";

import {
  type AnswerRequest,
  requestBody,
  type SendRequest,
  type StreamProgress,
  streamAnswer,
} from "./answer-stream";

/** Synthetic requests and replies only; no person's data. */

const REQUEST: AnswerRequest = {
  modelId: "qwen3:4b",
  turnId: "turn-synthetic-1",
  messages: [
    {
      role: "user",
      content: "How did heart rate change for synthetic subject 29bbf012?",
    },
  ],
};

const sse = (chunks: readonly unknown[]): string =>
  chunks
    .map(
      (chunk) => `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`,
    )
    .join("");

type Seen = { path?: string; body?: string };

const streamed =
  (chunks: readonly unknown[], seen: Seen = {}): SendRequest =>
  async (path, init) => {
    Object.assign(seen, { path, body: String(init.body) });
    return new Response(sse(chunks), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };

const DOCUMENT = {
  schema_version: "twin-llm.response.v1.1",
  intended_use: "research_hypothesis_generation_n_of_1",
  not_for_diagnostic_use: true,
  sufficient_data: true,
  abstained: false,
  answer_class: "analytics",
  data_basis: {
    evidence_keys: [],
    hallucinated_keys: [],
    tool_calls: [],
    sources: { gbd: [], guidelines: [], knowledge: [], literature: [] },
    gbd_rows: [],
  },
  uncertainty: { model_statement: null, level: "low", reasons: [] },
  next_step: "none",
  interpretation: { kind: "none" },
};

const METRICS = {
  modelId: "qwen3:4b",
  timeToFirstTokenMs: 120,
  tokensPerSecond: 31.5,
  inputTokens: 900,
  outputTokens: 40,
  totalTokens: 940,
  costUsd: 0,
};

const TEXT = [
  { type: "start" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "## Answer\nHeart rate " },
  { type: "text-delta", id: "t1", delta: "fell to 72.5 bpm." },
  { type: "text-end", id: "t1" },
];

describe("streamAnswer (SPEC 8.2)", () => {
  test("a finished stream is COMPLETE with its text, metrics and document", async () => {
    const updates: StreamProgress[] = [];
    const seen: { path?: string; body?: string } = {};
    const result = await streamAnswer(
      REQUEST,
      (progress) => updates.push(progress),
      streamed(
        [
          ...TEXT,
          {
            type: "message-metadata",
            messageMetadata: chatResponseMetadata(METRICS, DOCUMENT),
          },
          { type: "finish" },
        ],
        seen,
      ),
    );
    expect(seen.path).toBe("/api/chat");
    expect(result.ending).toBe("COMPLETE");
    expect(result.text).toBe("## Answer\nHeart rate fell to 72.5 bpm.");
    expect(result.metrics).toEqual(METRICS);
    expect(result.document?.answer_class).toBe("analytics");
    expect(result.refusal).toBeNull();
    expect(updates.length).toBeGreaterThan(0);
  });

  test("an invalid document is dropped; the answer still completes", async () => {
    const result = await streamAnswer(
      REQUEST,
      () => undefined,
      streamed([
        ...TEXT,
        {
          type: "message-metadata",
          messageMetadata: chatResponseMetadata(METRICS, { abstained: "maybe" }),
        },
        { type: "finish" },
      ]),
    );
    expect(result.ending).toBe("COMPLETE");
    expect(result.document).toBeNull();
    expect(result.metrics).toEqual(METRICS);
  });

  test("a body that stops before finish is LOST", async () => {
    const result = await streamAnswer(REQUEST, () => undefined, streamed(TEXT));
    expect(result.ending).toBe("LOST");
    expect(result.text).toContain("72.5");
  });

  test("an error part fails the column even when finish follows; its text is dropped", async () => {
    const result = await streamAnswer(
      REQUEST,
      () => undefined,
      streamed([
        ...TEXT,
        { type: "error", errorText: "provider said: secret detail" },
        { type: "finish" },
      ]),
    );
    expect(result.ending).toBe("FAILED");
    expect(result.refusal).toBeNull();
  });

  test("only the exact genome-identifier sentence becomes a refusal", async () => {
    const result = await streamAnswer(
      REQUEST,
      () => undefined,
      streamed([
        { type: "start" },
        { type: "error", errorText: GENOME_IDS_BLOCKED_SENTENCE },
        { type: "finish" },
      ]),
    );
    expect(result.ending).toBe("FAILED");
    expect(result.refusal).toBe(GENOME_IDS_BLOCKED_SENTENCE);
  });

  test("chunks that fail the schema are dropped, not fatal", async () => {
    const result = await streamAnswer(
      REQUEST,
      () => undefined,
      streamed([
        { type: "start" },
        "not json at all",
        { type: "no-such-chunk", x: 1 },
        ...TEXT.slice(1),
        { type: "finish" },
      ]),
    );
    expect(result.ending).toBe("COMPLETE");
    expect(result.text).toBe("## Answer\nHeart rate fell to 72.5 bpm.");
  });

  test("tool parts become cards; the number check marks reviewing until metadata", async () => {
    const updates: StreamProgress[] = [];
    const result = await streamAnswer(
      REQUEST,
      (progress) => updates.push(progress),
      streamed([
        { type: "start" },
        {
          type: "tool-input-available",
          toolCallId: "call-1",
          toolName: "trend",
          input: {
            subject_ref: "29bbf012",
            loinc: "8867-4",
            start: "2024-01-01",
            end: "2025-12-31",
          },
        },
        {
          type: "tool-output-available",
          toolCallId: "call-1",
          output: { rows: [{ loinc: "8867-4", display: "Heart rate", value: 72.5 }] },
        },
        { type: NUMBER_REVIEW_PART, data: { state: "running" } },
        ...TEXT.slice(1),
        {
          type: "message-metadata",
          messageMetadata: chatResponseMetadata(METRICS, DOCUMENT),
        },
        { type: "finish" },
      ]),
    );
    expect(updates.some((progress) => progress.reviewing)).toBe(true);
    expect(result.reviewing).toBe(false);
    expect(result.tools.map((card) => [card.tool, card.state, card.rowCount])).toEqual([
      ["trend", "done", 1],
    ]);
    expect(result.toolParts.map((part) => part.toolCallId)).toEqual(["call-1"]);
  });

  test("a response that is not OK fails; a 400 code maps only to fixed sentences", async () => {
    const reply =
      (status: number, body: unknown): SendRequest =>
      async () =>
        Response.json(body, { status });
    const cases: readonly [unknown, string | null][] = [
      [
        {
          code: PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
          error: "operator wording about settings",
        },
        PROVIDER_NOT_PERMITTED_SENTENCE,
      ],
      [{ code: GENOME_THREAD_LOCAL_ONLY, error: "anything" }, GENOME_THREAD_SENTENCE],
      [{ code: INCOGNITO_LOCAL_ONLY, error: "anything" }, INCOGNITO_LOCAL_ONLY_SENTENCE],
      [skillNotOffered("sleep"), skillNotOffered("sleep").error],
      [{ code: "SOMETHING_ELSE", error: "raw provider text" }, null],
      [{ error: "That request didn't look right." }, null],
    ];
    for (const [body, sentence] of cases) {
      const result = await streamAnswer(REQUEST, () => undefined, reply(400, body));
      expect([body, result.ending, result.refusal]).toEqual([body, "FAILED", sentence]);
    }
    const skill = await streamAnswer(
      REQUEST,
      () => undefined,
      reply(502, { code: SKILL_NOT_OFFERED, error: "x" }),
    );
    expect(skill.refusal).toBeNull();
  });

  test("a thrown send fails the column and logs only the model id and error name", async () => {
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const result = await streamAnswer(
        REQUEST,
        () => undefined,
        async () => {
          throw new TypeError("network down: How did heart rate change");
        },
      );
      expect(result.ending).toBe("FAILED");
      expect(JSON.stringify(logged)).not.toContain("heart rate");
      expect(JSON.stringify(logged)).toContain("TypeError");
    } finally {
      console.error = original;
    }
  });

  test("an aborted stream comes back marked aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await streamAnswer(
      REQUEST,
      () => undefined,
      async (_path, init) => {
        init.signal?.throwIfAborted();
        return new Response("");
      },
      { signal: controller.signal },
    );
    expect(result.aborted).toBe(true);
    expect(result.ending).toBe("FAILED");
  });
});

describe("request bodies (SERVER-SPEC 3.12)", () => {
  const full: AnswerRequest = {
    ...REQUEST,
    skill: "sleep",
    effort: "ultra",
    uiContext: {
      panels: ["outputs"],
      organ: null,
      chart: null,
      views: [],
      more_views: 0,
    } as unknown as AnswerRequest["uiContext"],
  };

  test("incognito sends no turn id and never on-screen context, to its own route", async () => {
    expect(JSON.parse(requestBody(full, true))).toEqual({
      modelId: REQUEST.modelId,
      messages: REQUEST.messages,
      skill: "sleep",
      effort: "ultra",
    });
    const seen: { path?: string } = {};
    await streamAnswer(full, () => undefined, streamed([{ type: "finish" }], seen), {
      incognito: true,
    });
    expect(seen.path).toBe("/api/chat/incognito");
  });

  test("a saved chat sends the turn id, skill, context and effort when present", () => {
    const body = JSON.parse(requestBody(full, false)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "effort",
      "messages",
      "modelId",
      "skill",
      "turnId",
      "uiContext",
    ]);
    expect(Object.keys(JSON.parse(requestBody(REQUEST, false)) as object).sort()).toEqual(
      ["messages", "modelId", "turnId"],
    );
  });
});

import { describe, expect, test } from "bun:test";

import {
  INCOGNITO_LOCAL_ONLY,
  INCOGNITO_LOCAL_ONLY_SENTENCE,
} from "@/infrastructure/incognito";

import { answerCall, refusalOf, streamAnswer } from "./answer-stream";
import { answerRequestFor, beginTurn, type BeginTurnDeps } from "./begin-turn";
import type { StartTurnInput } from "./start-turn";

const PROMPT = "How many synthetic subjects have a glucose reading?";
const MODELS = [
  { id: "llama3.2", name: "Llama 3.2" },
  { id: "mistral", name: "Mistral" },
];

const recordingDeps = () => {
  const started: StartTurnInput[] = [];
  const deps: BeginTurnDeps = {
    startTurn: async (input) => {
      started.push(input);
      return {
        ok: true,
        threadId: "thread-synthetic-1",
        threadTitle: "Synthetic subjects",
        turnId: "turn-synthetic-1",
        responses: [{ id: "row-1", modelId: "llama3.2", modelName: "Llama 3.2" }],
      };
    },
    randomId: () => "r1",
  };
  return { started, deps };
};

describe("starting a turn", () => {
  test("an incognito turn never calls startTurn and makes its ids up locally", async () => {
    const { started, deps } = recordingDeps();
    const turn = await beginTurn("incognito", deps, {
      threadId: null,
      prompt: PROMPT,
      models: MODELS,
      skill: null,
    });
    expect(started).toEqual([]);
    expect(turn).toEqual({
      ok: true,
      kind: "incognito",
      turnId: "incognito-r1",
      responses: [
        { id: "incognito-r1:llama3.2", modelId: "llama3.2", modelName: "Llama 3.2" },
        { id: "incognito-r1:mistral", modelId: "mistral", modelName: "Mistral" },
      ],
    });
  });

  test("a saved turn is written down through startTurn", async () => {
    const { started, deps } = recordingDeps();
    const turn = await beginTurn("saved", deps, {
      threadId: null,
      prompt: PROMPT,
      models: MODELS.slice(0, 1),
      skill: null,
    });
    expect(started).toEqual([
      { threadId: null, prompt: PROMPT, models: MODELS.slice(0, 1), skill: null },
    ]);
    expect(turn).toEqual({
      ok: true,
      kind: "saved",
      threadId: "thread-synthetic-1",
      threadTitle: "Synthetic subjects",
      turnId: "turn-synthetic-1",
      responses: [{ id: "row-1", modelId: "llama3.2", modelName: "Llama 3.2" }],
    });
  });
});

describe("asking for an answer", () => {
  const messages = [{ role: "user", content: PROMPT }] as const;

  test("incognito goes to /api/chat/incognito with no turn id", () => {
    const request = answerRequestFor("incognito", {
      modelId: "llama3.2",
      turnId: "incognito-r1",
      messages,
      skill: "sleep",
    });
    expect(answerCall(request)).toEqual({
      endpoint: "/api/chat/incognito",
      body: JSON.stringify({ modelId: "llama3.2", messages, skill: "sleep" }),
    });
  });

  test("a saved answer goes to /api/chat against its turn", () => {
    const request = answerRequestFor("saved", {
      modelId: "llama3.2",
      turnId: "turn-synthetic-1",
      messages,
      skill: null,
    });
    expect(answerCall(request)).toEqual({
      endpoint: "/api/chat",
      body: JSON.stringify({ modelId: "llama3.2", turnId: "turn-synthetic-1", messages }),
    });
  });

  test("the effort goes with the answer in both modes (#366)", () => {
    const base = {
      modelId: "llama3.2",
      turnId: "turn-synthetic-1",
      messages,
      skill: null,
    };
    expect(answerCall(answerRequestFor("saved", { ...base, effort: "ultra" }))).toEqual({
      endpoint: "/api/chat",
      body: JSON.stringify({
        modelId: "llama3.2",
        turnId: "turn-synthetic-1",
        messages,
        effort: "ultra",
      }),
    });
    expect(
      answerCall(answerRequestFor("incognito", { ...base, effort: "quick" })),
    ).toEqual({
      endpoint: "/api/chat/incognito",
      body: JSON.stringify({ modelId: "llama3.2", messages, effort: "quick" }),
    });
  });

  test("Stop aborts the request: the answer ends as failed, nothing is thrown", async () => {
    const stop = new AbortController();
    stop.abort();
    const result = await streamAnswer(
      { incognito: true, modelId: "llama3.2", messages },
      () => undefined,
      async (_input, init) => {
        if (init.signal?.aborted) throw new DOMException("stopped", "AbortError");
        return Response.json({ error: "x" }, { status: 503 });
      },
      stop.signal,
    );
    expect(result).toEqual({ ending: "FAILED", metrics: null, document: null });
  });

  test("streamAnswer posts an incognito request to the incognito route", async () => {
    const calls: string[] = [];
    await streamAnswer(
      { incognito: true, modelId: "llama3.2", messages },
      () => undefined,
      async (input, init) => {
        calls.push(`${input} ${String(init.body)}`);
        return Response.json({ error: "x" }, { status: 503 });
      },
    );
    expect(calls).toEqual([
      `/api/chat/incognito ${JSON.stringify({ modelId: "llama3.2", messages })}`,
    ]);
  });

  test("the local-only refusal reads as its sentence", async () => {
    const refused = Response.json(
      { code: INCOGNITO_LOCAL_ONLY, error: INCOGNITO_LOCAL_ONLY_SENTENCE },
      { status: 400 },
    );
    expect(await refusalOf(refused)).toBe(INCOGNITO_LOCAL_ONLY_SENTENCE);
  });
});

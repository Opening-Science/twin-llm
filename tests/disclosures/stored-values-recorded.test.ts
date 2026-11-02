import { describe, expect, test } from "bun:test";

import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

import {
  type Disclosure,
  modelCallFetch,
  type RecordDisclosure,
} from "@/infrastructure/disclosure-ledger";
import {
  type CheckFreeText,
  freeTextCheckOf,
  type StoredValues,
  storedValueMatches,
} from "@/infrastructure/free-text-check";
import type { QueryToolPorts } from "@/packages/query-tools/ports";

import { chatDisclosure } from "@/features/chat/chat-disclosure";
import { createStreamModelResponse } from "@/features/chat/create-stream-model-response";

/**
 * Lab values, coded values, clinical records and twin note lines in a hosted
 * chat request (#346) end to end: recorded as kinds and counts, never
 * blocked, and not counted when the person typed the value themselves. A
 * synthetic person only: two imported readings, one clinical record and one
 * twin note.
 */

const STORED: StoredValues = {
  readings: [
    { code: "2093-3", value: "195", unit: "mg/dL" },
    { code: null, value: "5.4", unit: "mmol/L" },
  ],
  records: [{ code: "38341003", display: "Hypertension" }],
  noteLines: ["Does evening exercise change my resting heart rate?"],
};

const COMPLETION = {
  id: "chatcmpl-synthetic",
  object: "chat.completion",
  created: 0,
  model: "synthetic/model",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Synthetic reply." },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

const network = () => {
  const requests: string[] = [];
  const fetchFn = (async (_input: unknown, init?: RequestInit) => {
    requests.push(String(init?.body ?? ""));
    return Response.json(COMPLETION);
  }) as unknown as typeof fetch;
  return { requests, fetch: fetchFn };
};

const book = () => {
  const rows: Disclosure[] = [];
  const record: RecordDisclosure = async (disclosure) => {
    rows.push(disclosure);
    return { seq: BigInt(rows.length), auditSeq: BigInt(rows.length) };
  };
  return { rows, record };
};

/** The synthetic person's checker, as `freeTextCheckerFor` builds it. */
const checkerFor =
  (typed: readonly string[]): CheckFreeText =>
  async (text) =>
    freeTextCheckOf(storedValueMatches(text, STORED, typed.join("\n")));

const CHAT = chatDisclosure({
  actor: "user_synthetic_1",
  turnId: "turn-synthetic-1",
  threadId: "thread-synthetic-1",
  mode: "personal",
  messageCount: 3,
  wearables: { oura: null, whoop: null, googleHealth: null, vitronic: null },
  noteIds: [],
  hasTools: false,
});

const hostedModel = (
  net: ReturnType<typeof network>,
  record: RecordDisclosure,
  checkText: CheckFreeText,
) =>
  createOpenAI({
    baseURL: "https://models.invalid/v1",
    apiKey: "synthetic",
    fetch: modelCallFetch(net.fetch, {
      recipient: "exoscale",
      modelId: "synthetic/model",
      disclosure: CHAT,
      record,
      checkText,
    }),
  }).chat("synthetic/model");

describe("stored values in a hosted chat request (#346)", () => {
  test("values from an earlier answer are recorded and the request is sent", async () => {
    const net = network();
    const ledger = book();
    const typed = ["How are my labs?", "And my blood pressure?"];
    const { text } = await generateText({
      model: hostedModel(net, ledger.record, checkerFor(typed)),
      system:
        "Twin notes: Does evening exercise change my resting heart rate?; Measures: none",
      messages: [
        { role: "user", content: typed[0] ?? "" },
        {
          role: "assistant",
          content:
            "Cholesterol (LOINC 2093-3) was 195 mg/dL and glucose 5.4 mmol/L. SNOMED 38341003 is on file.",
        },
        { role: "user", content: typed[1] ?? "" },
      ],
      maxRetries: 0,
    });
    expect(text).toBe("Synthetic reply.");
    expect(net.requests.length).toBe(1);
    expect(ledger.rows.map((row) => [row.direction, row.freeText])).toEqual([
      [
        undefined,
        {
          matches: [
            { kind: "lab value", count: 2 },
            { kind: "coded value", count: 1 },
            { kind: "clinical record", count: 1 },
            { kind: "twin note line", count: 1 },
          ],
        },
      ],
    ]);
    const rows = JSON.stringify(ledger.rows);
    for (const value of ["195", "5.4", "2093-3", "38341003", "evening exercise"]) {
      expect(rows).not.toContain(value);
    }
  });

  test("a value the person typed is not counted, even when the answer repeats it", async () => {
    const net = network();
    const ledger = book();
    const typed = ["My cholesterol was 195 mg/dL, is that high?"];
    await generateText({
      model: hostedModel(net, ledger.record, checkerFor(typed)),
      messages: [
        { role: "user", content: typed[0] ?? "" },
        {
          role: "assistant",
          content: "A cholesterol of 195 mg/dL is in a common range.",
        },
        { role: "user", content: "Thanks." },
      ],
      maxRetries: 0,
    });
    expect(net.requests.length).toBe(1);
    expect(ledger.rows.map((row) => row.freeText)).toEqual([{ matches: [] }]);
  });
});

const NO_QUERY: QueryToolPorts = {
  findSubject: async () => null,
  findObservations: async () => [],
  findCohortObservations: async () => [],
  appendAudit: async () => undefined,
};

describe("a chat turn passes what the person typed to the check (#346)", () => {
  test("only the person's own messages, in order", async () => {
    const seen: (readonly string[] | undefined)[] = [];
    const respond = createStreamModelResponse({
      settings: () => ({ dataMode: "synthetic", provider: "exoscale" }),
      chatIsLocal: () => false,
      resolveModel: (_modelId, options) => {
        seen.push(options.typed);
        return hostedModel(network(), book().record, checkerFor(options.typed ?? []));
      },
      genomeTools: () => undefined,
      variantTools: async () => undefined,
      importedTools: () => undefined,
      loadAudit: async () => [],
      store: {
        writeComplete: async () => undefined,
        writeFailed: async () => undefined,
        markRefused: async () => undefined,
        loadViews: async () => [],
      },
      analytics: { answered: () => undefined, generation: async () => undefined },
      query: NO_QUERY,
    });
    await respond(
      {
        modelId: "synthetic/model",
        turnId: "turn-synthetic-1",
        messages: [
          { role: "user", content: "First question" },
          { role: "assistant", content: "An answer with 195 mg/dL" },
          { role: "user", content: "Second question" },
        ],
      },
      {
        clerkId: "user_synthetic_1",
        genomeThread: false,
        ouraSummary: null,
        whoopSummary: null,
        googleHealthSummary: null,
        vitronicSummary: null,
      },
    );
    expect(seen[0]).toEqual(["First question", "Second question"]);
  });
});

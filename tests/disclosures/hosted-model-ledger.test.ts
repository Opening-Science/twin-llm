import { describe, expect, test } from "bun:test";

import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

import {
  type Disclosure,
  DisclosureNotRecordedError,
  modelCallFetch,
  type ModelDisclosure,
  type RecordDisclosure,
} from "@/infrastructure/disclosure-ledger";
import {
  type CheckFreeText,
  freeTextCheckOf,
  knownValueMatches,
  lookupMatches,
  variantCandidates,
} from "@/infrastructure/free-text-check";

import {
  createCompactHandler,
  noteDraftDisclosure,
} from "@/features/memory/compact-handler";
import { SYNTHETIC_THREAD } from "@/features/memory/fixtures";
import { createStarterGenerate } from "@/features/onboarding/starter-generate";

import { chatDisclosure } from "@/features/chat/chat-disclosure";

/**
 * The hosted-model paths of the disclosure ledger (#140) end to end through
 * the AI SDK: a real OpenAI-compatible model whose fetch is the one
 * `resolveLanguageModel` builds (`modelCallFetch`), over a fake network.
 * Each path is run with a working and a failing ledger; a failing ledger
 * must mean the network is never reached.
 */

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

type Network = { requests: string[]; fetch: typeof fetch };

const fakeNetwork = (): Network => {
  const requests: string[] = [];
  return {
    requests,
    fetch: (async (_input: unknown, init?: RequestInit) => {
      requests.push(String(init?.body ?? ""));
      return Response.json(COMPLETION);
    }) as unknown as typeof fetch,
  };
};

type Ledger = { rows: Disclosure[]; order: string[]; record: RecordDisclosure };

const ledger = (network: Network, failing = false): Ledger => {
  const rows: Disclosure[] = [];
  const order: string[] = [];
  return {
    rows,
    order,
    record: async (disclosure) => {
      if (failing) throw new DisclosureNotRecordedError("Error");
      // Nothing may have been sent for this request yet.
      order.push(`ledger after ${network.requests.length} sent`);
      rows.push(disclosure);
      return { seq: BigInt(rows.length), auditSeq: BigInt(rows.length) };
    },
  };
};

/** What `resolveLanguageModel` returns for a hosted provider, with these ports. */
const hostedModel = (
  network: Network,
  record: RecordDisclosure,
  disclosure: ModelDisclosure,
  checkText?: CheckFreeText,
) =>
  createOpenAI({
    baseURL: "https://models.invalid/v1",
    apiKey: "synthetic",
    fetch: modelCallFetch(network.fetch, {
      recipient: "exoscale",
      modelId: "synthetic/model",
      disclosure,
      record,
      ...(checkText === undefined ? {} : { checkText }),
    }),
  }).chat("synthetic/model");

const CHAT = chatDisclosure({
  actor: "user_synthetic_1",
  turnId: "turn-synthetic-1",
  threadId: "thread-synthetic-1",
  mode: "personal",
  messageCount: 1,
  wearables: { oura: null, whoop: null, googleHealth: null, vitronic: null },
  noteIds: [],
  hasTools: false,
});

describe("chat answer through a hosted model", () => {
  test("each request is in the ledger before it is sent, with its size", async () => {
    const network = fakeNetwork();
    const book = ledger(network);
    await generateText({
      model: hostedModel(network, book.record, CHAT),
      prompt: "A synthetic question",
      maxRetries: 0,
    });
    expect(book.order).toEqual(["ledger after 0 sent"]);
    expect(network.requests.length).toBe(1);
    expect(book.rows).toEqual([
      {
        ...CHAT,
        kind: "hosted-model",
        recipient: "exoscale",
        target: "synthetic/model",
        payloadBytes: Buffer.byteLength(network.requests[0] ?? "", "utf8"),
      },
    ]);
  });

  test("the question's text is checked and the row says what it held (#346)", async () => {
    const network = fakeNetwork();
    const book = ledger(network);
    // A synthetic person: one imported VCF holding rs4988235, a body scan labelled "Demo body".
    const stored = new Set(["hash.rs4988235"]);
    const check: CheckFreeText = async (text) =>
      freeTextCheckOf(
        knownValueMatches(text, [{ kind: "body scan label", value: "Demo body" }]),
        lookupMatches(
          variantCandidates(text),
          { rsid: (rsid) => [`hash.${rsid}`], site: (site) => [`hash.${site}`] },
          { rsids: stored, sites: new Set() },
        ),
      );
    await generateText({
      model: hostedModel(network, book.record, CHAT, check),
      // rs1801133 is not in their file. One of theirs blocks the send (#356,
      // genome-ids-blocked.test.ts).
      prompt: "Does rs1801133 explain the Demo body scan?",
      maxRetries: 0,
    });
    expect(book.rows.map((row) => row.freeText)).toEqual([
      { matches: [{ kind: "body scan label", count: 1 }] },
    ]);
    expect(JSON.stringify(book.rows)).not.toContain("Demo body");
  });

  test("a failing ledger means nothing is sent and the call fails", async () => {
    const network = fakeNetwork();
    const book = ledger(network, true);
    await expect(
      generateText({
        model: hostedModel(network, book.record, CHAT),
        prompt: "A synthetic question",
        maxRetries: 2,
      }),
    ).rejects.toThrow();
    expect(network.requests).toEqual([]);
  });
});

const compactWith = (network: Network, book: Ledger) =>
  createCompactHandler({
    resolveActorId: async () => "user_synthetic_1",
    loadOwnedThread: async () => SYNTHETIC_THREAD,
    threadIsLocal: async () => false,
    turn: () => ({
      mode: "synthetic",
      provider: "exoscale",
      exoscalePersonalData: "off",
      chatIsLocal: false,
    }),
    draftModel: async (_source, disclosure) => ({
      modelId: "synthetic/model",
      generate: async ({ system, prompt }) =>
        (
          await generateText({
            model: hostedModel(network, book.record, disclosure),
            system,
            prompt,
            maxRetries: 0,
          })
        ).text,
    }),
    providerEvent: () => null,
    appendAudit: async () => undefined,
    logError: () => undefined,
  });

const compactRequest = () =>
  new Request("http://localhost/api/memory/compact", {
    method: "POST",
    body: JSON.stringify({ threadId: SYNTHETIC_THREAD.id }),
  });

describe("/compact note draft through a hosted model", () => {
  test("the draft request is in the ledger first, as a note draft of the thread", async () => {
    const network = fakeNetwork();
    const book = ledger(network);
    await compactWith(network, book)(compactRequest());
    expect(book.order).toEqual(["ledger after 0 sent"]);
    expect(book.rows.map((row) => [row.purpose, row.threadId, row.synthetic])).toEqual([
      ["note draft", SYNTHETIC_THREAD.id, true],
    ]);
    expect(noteDraftDisclosure("a", "t", "personal").categories).toEqual([
      "question text",
      "answers",
    ]);
  });

  test("a failing ledger means the thread is never sent; the draft falls back", async () => {
    const network = fakeNetwork();
    const response = await compactWith(network, ledger(network, true))(compactRequest());
    expect(network.requests).toEqual([]);
    expect(((await response.json()) as { notice?: string }).notice).toBe(
      "The model gave no usable summary, so the topics are your own questions.",
    );
  });
});

const startersWith = (network: Network, book: Ledger) =>
  createStarterGenerate({
    dataMode: () => "synthetic",
    loadModelIds: async () => ["synthetic/model"],
    resolveModel: (_modelId, { disclosure }) =>
      hostedModel(network, book.record, "notRecorded" in disclosure ? CHAT : disclosure),
    recordSend: async () => undefined,
    generateText: async ({ model, system, prompt, abortSignal, maxRetries }) =>
      generateText({ model, system, prompt, abortSignal, maxRetries }),
  });

const starterCall = {
  system: "sys",
  prompt: "p",
  abortSignal: new AbortController().signal,
};

describe("starter questions through a hosted model", () => {
  test("the request is in the ledger first", async () => {
    const network = fakeNetwork();
    const book = ledger(network);
    expect(await startersWith(network, book)(false, "local")(starterCall)).toBe(
      "Synthetic reply.",
    );
    expect(book.order).toEqual(["ledger after 0 sent"]);
    expect(book.rows.map((row) => row.purpose)).toEqual(["starter questions"]);
  });

  test("a failing ledger means nothing is sent", async () => {
    const network = fakeNetwork();
    await expect(
      startersWith(network, ledger(network, true))(false, "local")(starterCall),
    ).rejects.toThrow();
    expect(network.requests).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";

import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

import {
  type Disclosure,
  GenomeIdsBlockedError,
  modelCallFetch,
  type ModelDisclosure,
  type RecordDisclosure,
} from "@/infrastructure/disclosure-ledger";
import {
  type CheckFreeText,
  FREE_TEXT_KIND,
  freeTextCheckOf,
  GENOME_IDS_BLOCKED_SENTENCE,
  knownValueMatches,
  lookupMatches,
  variantCandidates,
} from "@/infrastructure/free-text-check";
import type { QueryToolPorts } from "@/packages/query-tools/ports";

import { streamAnswer } from "@/features/arena/answer-stream";
import { chatDisclosure } from "@/features/chat/chat-disclosure";
import { createStreamModelResponse } from "@/features/chat/create-stream-model-response";

/**
 * Option C of #356 end to end: a request to a hosted model that carries the
 * person's own rsIDs or genome sites is not sent. The ledger records it as
 * blocked (kinds and counts only), and the person reads a plain refusal in
 * the answer column. Other matches are recorded and sent. A synthetic
 * person only: one imported VCF holding rs4988235 and chr7:117559590, and a
 * body scan labelled "Demo body".
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

const book = () => {
  const rows: Disclosure[] = [];
  const record: RecordDisclosure = async (disclosure) => {
    rows.push(disclosure);
    return { seq: BigInt(rows.length), auditSeq: BigInt(rows.length) };
  };
  return { rows, record };
};

const STORED_RSIDS = new Set(["hash.rs4988235"]);
const STORED_SITES = new Set(["hash.chr7:117559590"]);

/** The synthetic person's checker: keyed hashes faked as `hash.<value>`. */
const syntheticCheck: CheckFreeText = async (text) =>
  freeTextCheckOf(
    knownValueMatches(text, [{ kind: FREE_TEXT_KIND.label, value: "Demo body" }]),
    lookupMatches(
      variantCandidates(text),
      { rsid: (rsid) => [`hash.${rsid}`], site: (site) => [`hash.${site}`] },
      { rsids: STORED_RSIDS, sites: STORED_SITES },
    ),
  );

const lockedCheck: CheckFreeText = async () => {
  throw new Error("PersonalDataLockedError");
};

const CHAT: ModelDisclosure = chatDisclosure({
  actor: "user_synthetic_1",
  turnId: "turn-synthetic-1",
  threadId: "thread-synthetic-1",
  mode: "personal",
  messageCount: 1,
  wearables: { oura: null, whoop: null, googleHealth: null, vitronic: null },
  noteIds: [],
  hasTools: false,
});

const modelFor = (
  network: Network,
  record: RecordDisclosure,
  checkText: CheckFreeText,
  recipient: string | null = "exoscale",
) =>
  createOpenAI({
    baseURL: "https://models.invalid/v1",
    apiKey: "synthetic",
    fetch: modelCallFetch(network.fetch, {
      recipient,
      modelId: "synthetic/model",
      disclosure: CHAT,
      record,
      checkText,
    }),
  }).chat("synthetic/model");

const ask = (
  prompt: string,
  checkText: CheckFreeText = syntheticCheck,
  recipient: string | null = "exoscale",
) => {
  const network = fakeNetwork();
  const ledger = book();
  const call = generateText({
    model: modelFor(network, ledger.record, checkText, recipient),
    prompt,
    maxRetries: 2,
  });
  return { network, ledger, call };
};

describe("a hosted chat request with the person's genome identifiers (#356)", () => {
  test("an rsID of theirs: nothing is sent, the row is blocked with counts only", async () => {
    const { network, ledger, call } = ask("Does rs4988235 explain my lactose trouble?");
    await expect(call).rejects.toBeInstanceOf(GenomeIdsBlockedError);
    expect(network.requests).toEqual([]);
    expect(ledger.rows.map((row) => [row.direction, row.freeText])).toEqual([
      ["blocked", { matches: [{ kind: "rsID", count: 1 }] }],
    ]);
    expect(JSON.stringify(ledger.rows)).not.toContain("rs4988235");
  });

  test("a genome position of theirs, in either spelling: nothing is sent", async () => {
    for (const prompt of ["What is at chr7:117559590?", "What is at 7:117559590?"]) {
      const { network, ledger, call } = ask(prompt);
      await expect(call).rejects.toThrow(GENOME_IDS_BLOCKED_SENTENCE);
      expect(network.requests).toEqual([]);
      expect(ledger.rows.map((row) => [row.direction, row.freeText])).toEqual([
        ["blocked", { matches: [{ kind: "genome site", count: 1 }] }],
      ]);
      expect(JSON.stringify(ledger.rows)).not.toContain("117559590");
    }
  });

  test("a stored name is recorded and the request is sent", async () => {
    const { network, ledger, call } = ask("How did the Demo body scan look?");
    expect((await call).text).toBe("Synthetic reply.");
    expect(network.requests.length).toBe(1);
    expect(ledger.rows.map((row) => [row.direction, row.freeText])).toEqual([
      [undefined, { matches: [{ kind: "body scan label", count: 1 }] }],
    ]);
  });

  test("an rsID that is not theirs is sent", async () => {
    const { network, call } = ask("What does rs1801133 do in general?");
    await call;
    expect(network.requests.length).toBe(1);
  });

  test("a failed check on rsID-shaped text blocks; on other text it is sent", async () => {
    const shaped = ask("Is rs4988235 in my file?", lockedCheck);
    await expect(shaped.call).rejects.toBeInstanceOf(GenomeIdsBlockedError);
    expect(shaped.network.requests).toEqual([]);
    expect(shaped.ledger.rows.map((row) => [row.direction, row.freeText])).toEqual([
      ["blocked", undefined],
    ]);

    const plain = ask("How did I sleep last week?", lockedCheck);
    await plain.call;
    expect(plain.network.requests.length).toBe(1);
    expect(plain.ledger.rows.map((row) => [row.direction, row.freeText])).toEqual([
      [undefined, undefined],
    ]);
  });

  test("a model on this machine gets the request; nothing is checked or recorded", async () => {
    const { network, ledger, call } = ask("Does rs4988235 matter?", syntheticCheck, null);
    await call;
    expect(network.requests.length).toBe(1);
    expect(ledger.rows).toEqual([]);
  });
});

// ─── What the person reads ──────────────────────────────────────────────────

const NO_QUERY: QueryToolPorts = {
  findSubject: async () => null,
  findObservations: async () => [],
  findCohortObservations: async () => [],
  appendAudit: async () => undefined,
};

describe("the answer column after a blocked request (#356)", () => {
  test("the row is stored as refused and the stream carries the refusal", async () => {
    const network = fakeNetwork();
    const ledger = book();
    const stored: string[] = [];
    const respond = createStreamModelResponse({
      settings: () => ({ dataMode: "synthetic", provider: "exoscale" }),
      chatIsLocal: () => false,
      resolveModel: () => modelFor(network, ledger.record, syntheticCheck),
      genomeTools: () => undefined,
      variantTools: () => undefined,
      importedTools: () => undefined,
      loadAudit: async () => [],
      store: {
        writeComplete: async () => {
          stored.push("complete");
        },
        writeFailed: async () => {
          stored.push("failed");
        },
        markRefused: async ({ sentence }) => {
          stored.push(`refused: ${sentence}`);
        },
        loadViews: async () => [],
      },
      analytics: { answered: () => undefined, generation: async () => undefined },
      query: NO_QUERY,
    });
    const request = {
      modelId: "synthetic/model",
      turnId: "turn-synthetic-1",
      messages: [{ role: "user" as const, content: "Is rs4988235 in my file?" }],
    };
    const response = await respond(request, {
      clerkId: "user_synthetic_1",
      genomeThread: false,
      ouraSummary: null,
      whoopSummary: null,
      googleHealthSummary: null,
      vitronicSummary: null,
    });
    const result = await streamAnswer(
      request,
      () => undefined,
      async () => response,
    );

    expect(network.requests).toEqual([]);
    expect(ledger.rows.map((row) => row.direction)).toEqual(["blocked"]);
    expect(result.ending).toBe("FAILED");
    expect(result.refusal).toBe(GENOME_IDS_BLOCKED_SENTENCE);
    expect(stored).toEqual([`refused: ${GENOME_IDS_BLOCKED_SENTENCE}`]);
  });
});

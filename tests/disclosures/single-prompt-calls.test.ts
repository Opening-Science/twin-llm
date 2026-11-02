import { describe, expect, test } from "bun:test";

import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

import {
  type Disclosure,
  modelCallFetch,
  type ModelDisclosure,
  type RecordDisclosure,
} from "@/infrastructure/disclosure-ledger";
import {
  type CheckFreeText,
  freeTextCheckOf,
  GENOME_IDS_BLOCKED_SENTENCE,
  lookupMatches,
  type StoredValues,
  storedValueMatches,
  variantCandidates,
} from "@/infrastructure/free-text-check";
import type { NoteTurn } from "@/infrastructure/twin-notes";

import { runNumberReview } from "@/features/chat/run-number-review";
import type { CompactThread } from "@/features/memory/compact-draft";
import { createCompactHandler } from "@/features/memory/compact-handler";
import { SYNTHETIC_THREAD } from "@/features/memory/fixtures";
import { createStarterGenerate } from "@/features/onboarding/starter-generate";
import { generateStarterQuestions } from "@/features/onboarding/starter-questions";

/**
 * The single-prompt hosted calls (#414): a `/compact` draft, the Ultra number
 * check and the starter questions. Each passes what the person typed, so the
 * free text check does not count a stored value they wrote themselves, and
 * each shows the fixed refusal when its request is blocked for the person's
 * own genome identifiers (#356). A synthetic person only: one imported
 * reading, one rsID and one genome site.
 */

const STORED: StoredValues = {
  readings: [{ code: "2093-3", value: "195", unit: "mg/dL" }],
  records: [],
  noteLines: [],
};

const COMPLETION = {
  id: "chatcmpl-synthetic",
  object: "chat.completion",
  created: 0,
  model: "synthetic/model",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: '{"topics": ["Cholesterol"], "open_questions": []}',
      },
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

/** The synthetic person's checker, as `freeTextCheckerFor` builds it; hashes faked as `hash.<value>`. */
const checkerFor =
  (typed: readonly string[]): CheckFreeText =>
  async (text) =>
    freeTextCheckOf(
      storedValueMatches(text, STORED, typed.join("\n")),
      lookupMatches(
        variantCandidates(text),
        { rsid: (rsid) => [`hash.${rsid}`], site: (site) => [`hash.${site}`] },
        { rsids: new Set(["hash.rs4988235"]), sites: new Set(["hash.chr7:117559590"]) },
      ),
    );

const DISCLOSURE: ModelDisclosure = {
  actor: "user_synthetic_1",
  sessionId: "thread-synthetic-1",
  threadId: "thread-synthetic-1",
  purpose: "synthetic",
  categories: [],
  refs: [],
  synthetic: false,
};

const hostedModel = (
  net: ReturnType<typeof network>,
  record: RecordDisclosure,
  checkText: CheckFreeText,
  disclosure: ModelDisclosure = DISCLOSURE,
) =>
  createOpenAI({
    baseURL: "https://models.invalid/v1",
    apiKey: "synthetic",
    fetch: modelCallFetch(net.fetch, {
      recipient: "exoscale",
      modelId: "synthetic/model",
      disclosure,
      record,
      checkText,
    }),
  }).chat("synthetic/model");

const freeTextOf = (rows: readonly Disclosure[]) =>
  rows.map((row) => [row.direction, row.freeText]);

describe("/compact drafts (#414)", () => {
  const TURN: NoteTurn = {
    mode: "personal",
    provider: "exoscale",
    exoscalePersonalData: "consented-pilot",
    chatIsLocal: false,
  };

  const threadWith = (prompt: string, answer: string): CompactThread => {
    const [first] = SYNTHETIC_THREAD.turns;
    if (first === undefined) throw new Error("fixture has no turn");
    const [firstAnswer] = first.answers;
    if (firstAnswer === undefined) throw new Error("fixture has no answer");
    return {
      ...SYNTHETIC_THREAD,
      turns: [
        { ...first, prompt, answers: [{ ...firstAnswer, text: answer, tools: [] }] },
      ],
    };
  };

  const draft = async (thread: CompactThread) => {
    const net = network();
    const ledger = book();
    const handle = createCompactHandler({
      resolveActorId: async () => "user_synthetic_1",
      loadOwnedThread: async () => thread,
      threadIsLocal: async () => false,
      turn: () => TURN,
      draftModel: async (source, disclosure, typed) => {
        const model = hostedModel(net, ledger.record, checkerFor(typed), disclosure);
        return {
          modelId: source.modelId,
          generate: async ({ system, prompt }) =>
            (await generateText({ model, system, prompt, maxRetries: 0 })).text,
        };
      },
      providerEvent: () => null,
      appendAudit: async () => ({}),
      logError: () => undefined,
    });
    const response = await handle(
      new Request("http://localhost/api/memory/compact", {
        method: "POST",
        body: JSON.stringify({ threadId: thread.id }),
      }),
    );
    return { net, ledger, body: Object(await response.json()) };
  };

  test("a value the person wrote in the thread is not counted", async () => {
    const { net, ledger, body } = await draft(
      threadWith(
        "My cholesterol was 195 mg/dL. Is that usual for my age?",
        "## Answer\nA total cholesterol of 195 mg/dL sits near common reference ranges.",
      ),
    );
    expect(net.requests.length).toBe(1);
    expect(freeTextOf(ledger.rows)).toEqual([[undefined, { matches: [] }]]);
    expect(Reflect.get(body, "notice")).toBeUndefined();
  });

  test("a stored value only the answer holds is still counted", async () => {
    const { ledger } = await draft(
      threadWith(
        "How are my labs?",
        "## Answer\nYour cholesterol was 195 mg/dL in the imported readings.",
      ),
    );
    expect(freeTextOf(ledger.rows)).toEqual([
      [undefined, { matches: [{ kind: "lab value", count: 1 }] }],
    ]);
  });

  test("a thread holding their rsID is not sent, and the notice is the refusal", async () => {
    const { net, ledger, body } = await draft(
      threadWith(
        "What does my genome say about lactose?",
        "## Answer\nrs4988235 is on file.",
      ),
    );
    expect(net.requests).toEqual([]);
    expect(freeTextOf(ledger.rows)).toEqual([
      ["blocked", { matches: [{ kind: "rsID", count: 1 }] }],
    ]);
    expect(Reflect.get(body, "notice")).toBe(GENOME_IDS_BLOCKED_SENTENCE);
  });
});

describe("the Ultra number check (#414)", () => {
  const QUESTION = "My cholesterol was 195 mg/dL. What was my weight?";
  const RESULTS = [
    {
      toolName: "observations",
      input: { loinc: "29463-7" },
      output: { rows: [{ loinc: "29463-7", value: 80, unit_ucum: "kg" }] },
    },
  ];

  const review = async (answer: string, typed: readonly string[]) => {
    const net = network();
    const ledger = book();
    const result = await runNumberReview(
      hostedModel(net, ledger.record, checkerFor(typed)),
      answer,
      RESULTS,
    );
    return { net, ledger, result };
  };

  test("the question's own value is not counted when the answer repeats it", async () => {
    const answer = "Weight was 80 kg. The 195 mg/dL you gave is not in the rows.";
    const withQuestion = await review(answer, [QUESTION]);
    expect(withQuestion.net.requests.length).toBe(1);
    expect(freeTextOf(withQuestion.ledger.rows)).toEqual([[undefined, { matches: [] }]]);
    // Without the question the same request counts it: the typed text is what changed.
    const without = await review(answer, []);
    expect(freeTextOf(without.ledger.rows)).toEqual([
      [undefined, { matches: [{ kind: "lab value", count: 1 }] }],
    ]);
  });

  test("an answer holding their rsID is not sent, and the step shows the refusal", async () => {
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      const { net, result } = await review("Weight was 80 kg; rs4988235 is on file.", [
        QUESTION,
      ]);
      expect(net.requests).toEqual([]);
      expect(result.status).toBe("failed");
      expect(result.refusal).toBe(GENOME_IDS_BLOCKED_SENTENCE);
    } finally {
      console.error = original;
    }
    expect(errors).toEqual([["[chat] number check blocked: genome identifiers"]]);
  });
});

describe("starter questions (#414)", () => {
  const starters = async (interest: string) => {
    const net = network();
    const ledger = book();
    const options: unknown[] = [];
    const generate = createStarterGenerate({
      loadModelIds: async () => ["synthetic/model"],
      resolveModel: (_modelId, given) => {
        options.push(given);
        return hostedModel(net, ledger.record, checkerFor(given.typed ?? []));
      },
      dataMode: () => "personal",
      recordSend: async () => undefined,
      generateText,
    })(true, "user_synthetic_1");
    const result = await generateStarterQuestions(
      { roles: ["self-tracker"], dataChoice: "own", interest, connected: ["Oura"] },
      { generate, timeoutMs: 5000, logError: () => undefined },
    );
    return { net, ledger, options, result };
  };

  test("a stored value the person typed in their interest is not counted", async () => {
    const interest = "why my cholesterol of 195 mg/dL moves with sleep";
    const { net, ledger, options } = await starters(interest);
    expect(net.requests.length).toBe(1);
    expect(Reflect.get(Object(options[0]), "typed")).toEqual([interest]);
    expect(freeTextOf(ledger.rows)).toEqual([[undefined, { matches: [] }]]);
  });

  test("an interest holding their rsID is not sent, and the refusal shows", async () => {
    const { net, ledger, result } = await starters("what rs4988235 means for lactose");
    expect(net.requests).toEqual([]);
    expect(freeTextOf(ledger.rows)).toEqual([
      ["blocked", { matches: [{ kind: "rsID", count: 1 }] }],
    ]);
    expect(result.source).toBe("fallback");
    expect(result.notice).toBe(GENOME_IDS_BLOCKED_SENTENCE);
  });
});

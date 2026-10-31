import { describe, expect, test } from "bun:test";

import {
  bodyBytes,
  createRecordDisclosure,
  type Disclosure,
  disclosureAuditEvent,
  DisclosureNotRecordedError,
  type LedgerEntry,
  ledgerTotals,
  ledgeredFetch,
  modelCallFetch,
  type ModelDisclosure,
  modelRecipient,
  telemetryDisclosure,
} from "./disclosure-ledger";

const DISCLOSURE: Disclosure = {
  actor: "user_synthetic_1",
  sessionId: "turn-synthetic-1",
  kind: "hosted-model",
  recipient: "exoscale",
  target: "swiss-ai/Apertus-8B-Instruct-2509",
  purpose: "chat answer",
  categories: ["question text", "wearable summary"],
  refs: [{ source: "wearable", key: "oura.sleep.score.2026-01-01" }],
  payloadBytes: 1234,
  threadId: "thread-synthetic-1",
  synthetic: false,
};

const MODEL_CALL: ModelDisclosure = {
  actor: "user_synthetic_1",
  sessionId: "turn-synthetic-1",
  threadId: "thread-synthetic-1",
  purpose: "chat answer",
  categories: ["question text"],
  refs: [],
  synthetic: true,
};

const RECEIPT = { seq: 1n, auditSeq: 7n };

describe("disclosureAuditEvent", () => {
  test("names the kind and recipient and counts, never a value", () => {
    expect(disclosureAuditEvent(DISCLOSURE)).toEqual({
      actor: "user_synthetic_1",
      sessionId: "turn-synthetic-1",
      subjectRef: null,
      tool: "disclosure.hosted-model",
      args: {
        recipient: "exoscale",
        target: "swiss-ai/Apertus-8B-Instruct-2509",
        purpose: "chat answer",
      },
      result: {
        direction: "sent",
        categories: ["question text", "wearable summary"],
        bytes: 1234,
        synthetic: false,
      },
      rowCount: 1,
    });
    expect(JSON.stringify(disclosureAuditEvent(DISCLOSURE))).not.toContain("oura.sleep");
  });
});

describe("createRecordDisclosure", () => {
  test("writes the disclosure with its own audit row, or with the paired one", async () => {
    const written: unknown[] = [];
    const record = createRecordDisclosure(async (disclosure, audit) => {
      written.push([disclosure.kind, audit.tool]);
      return RECEIPT;
    });
    expect(await record(DISCLOSURE)).toEqual(RECEIPT);
    await record(DISCLOSURE, {
      ...disclosureAuditEvent(DISCLOSURE),
      tool: "thread.export",
    });
    expect(written).toEqual([
      ["hosted-model", "disclosure.hosted-model"],
      ["hosted-model", "thread.export"],
    ]);
  });

  test("a failed write rejects with the error's name only", async () => {
    const record = createRecordDisclosure(async () => {
      throw new TypeError("connection to synthetic-host refused");
    });
    const error = await record(DISCLOSURE).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DisclosureNotRecordedError);
    expect((error as DisclosureNotRecordedError).reason).toBe("TypeError");
    expect((error as Error).message).not.toContain("synthetic-host");
  });

  test("a disclosure that is wrong on its face is refused before any write", async () => {
    let writes = 0;
    const record = createRecordDisclosure(async () => {
      writes += 1;
      return RECEIPT;
    });
    const reasons = await Promise.all(
      [
        { ...DISCLOSURE, actor: " " },
        { ...DISCLOSURE, recipient: "" },
        { ...DISCLOSURE, categories: [] },
        { ...DISCLOSURE, payloadBytes: -1 },
        { ...DISCLOSURE, payloadBytes: 1.5 },
      ].map((bad) =>
        record(bad).catch(
          (error: unknown) => (error as DisclosureNotRecordedError).reason,
        ),
      ),
    );
    expect(reasons).toEqual([
      "no actor",
      "no recipient",
      "no category",
      "bad size",
      "bad size",
    ]);
    expect(writes).toBe(0);
  });
});

describe("modelRecipient", () => {
  test("Ollama on this machine is not a recipient; everything else is", () => {
    expect(modelRecipient("ollama", true)).toBe(null);
    expect(modelRecipient("ollama", false)).toBe("ollama on another machine");
    expect(modelRecipient("exoscale", true)).toBe("exoscale");
    expect(modelRecipient("remote-gpu", true)).toBe("remote-gpu");
    expect(modelRecipient("openrouter", false)).toBe("openrouter");
    expect(modelRecipient("infomaniak", false)).toBe("infomaniak");
  });
});

describe("bodyBytes", () => {
  test("measures text and bytes, and says when it cannot", () => {
    expect(bodyBytes(undefined)).toBe(0);
    expect(bodyBytes("héllo")).toBe(6);
    expect(bodyBytes(new Uint8Array(5))).toBe(5);
    expect(bodyBytes(new ArrayBuffer(3))).toBe(3);
    expect(bodyBytes(new URLSearchParams({ a: "b" }))).toBe(3);
    expect(bodyBytes(new Blob(["abcd"]))).toBe(4);
    expect(bodyBytes(new ReadableStream())).toBe(null);
  });
});

/** A fetch that only notes it was called. */
const fakeFetch = (order: string[]): typeof fetch =>
  (async () => {
    order.push("send");
    return new Response("{}");
  }) as unknown as typeof fetch;

describe("ledgeredFetch", () => {
  test("records the request's size before it is sent", async () => {
    const order: string[] = [];
    const sizes: (number | null)[] = [];
    const send = ledgeredFetch(fakeFetch(order), async (bytes) => {
      order.push("record");
      sizes.push(bytes);
    });
    await send("https://models.invalid/v1/chat", { method: "POST", body: "abc" });
    expect(order).toEqual(["record", "send"]);
    expect(sizes).toEqual([3]);
  });

  test("a failed record means no request", async () => {
    const order: string[] = [];
    const send = ledgeredFetch(fakeFetch(order), async () => {
      throw new DisclosureNotRecordedError("Error");
    });
    await expect(send("https://models.invalid/v1/chat", { body: "abc" })).rejects.toThrow(
      DisclosureNotRecordedError,
    );
    expect(order).toEqual([]);
  });
});

describe("modelCallFetch", () => {
  test("a model on this machine and an unrecorded call send as they are", () => {
    const plain = fakeFetch([]);
    const record = async () => RECEIPT;
    expect(
      modelCallFetch(plain, {
        recipient: null,
        modelId: "qwen3:8b",
        disclosure: MODEL_CALL,
        record,
      }),
    ).toBe(plain);
    expect(
      modelCallFetch(plain, {
        recipient: "exoscale",
        modelId: "qwen3:8b",
        disclosure: { notRecorded: "evaluation harness" },
        record,
      }),
    ).toBe(plain);
  });

  test("a hosted model records each request as a hosted-model row", async () => {
    const order: string[] = [];
    const rows: Disclosure[] = [];
    const send = modelCallFetch(fakeFetch(order), {
      recipient: "openrouter",
      modelId: "synthetic/model",
      disclosure: MODEL_CALL,
      record: async (disclosure) => {
        order.push("record");
        rows.push(disclosure);
        return RECEIPT;
      },
    });
    await send("https://models.invalid/v1/chat", { body: "12345" });
    await send("https://models.invalid/v1/chat", { body: "1234567" });
    expect(order).toEqual(["record", "send", "record", "send"]);
    expect(rows.map((row) => row.payloadBytes)).toEqual([5, 7]);
    expect(rows[0]).toEqual({
      ...MODEL_CALL,
      kind: "hosted-model",
      recipient: "openrouter",
      target: "synthetic/model",
      payloadBytes: 5,
    });
  });
});

describe("telemetryDisclosure", () => {
  test("names the event and says ids and counts", () => {
    expect(
      telemetryDisclosure({ distinctId: "local", event: "prompt_sent", synthetic: true }),
    ).toEqual({
      actor: "local",
      sessionId: "prompt_sent",
      kind: "telemetry",
      recipient: "PostHog",
      target: "prompt_sent",
      purpose: "product analytics",
      categories: ["usage ids and counts"],
      refs: [],
      payloadBytes: null,
      threadId: null,
      synthetic: true,
    });
  });
});

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 31, 12, minute));

const row = (overrides: Partial<LedgerEntry>): LedgerEntry => ({
  seq: 1,
  ts: at(0),
  kind: "hosted-model",
  direction: "sent",
  recipient: "exoscale",
  target: "m",
  purpose: "chat answer",
  categories: ["question text"],
  refCount: 0,
  payloadBytes: 100,
  threadId: null,
  synthetic: false,
  ...overrides,
});

describe("ledgerTotals", () => {
  test("adds up each recipient over time, newest recipient first", () => {
    const totals = ledgerTotals([
      row({ ts: at(5), refCount: 3, categories: ["question text", "wearable summary"] }),
      row({ ts: at(1), payloadBytes: null, synthetic: true }),
      row({
        ts: at(3),
        kind: "vendor-sync",
        recipient: "Oura",
        categories: ["access token", "date window"],
        payloadBytes: null,
      }),
      row({
        ts: at(9),
        kind: "ark-release",
        direction: "received",
        recipient: "this machine, from the Ark",
        categories: ["genome report"],
        refCount: 11,
        payloadBytes: null,
      }),
    ]);
    expect(totals).toEqual([
      {
        recipient: "this machine, from the Ark",
        direction: "received",
        events: 1,
        syntheticEvents: 0,
        refs: 11,
        bytes: 0,
        unmeasured: 1,
        first: at(9),
        last: at(9),
        categories: [{ category: "genome report", events: 1 }],
      },
      {
        recipient: "exoscale",
        direction: "sent",
        events: 2,
        syntheticEvents: 1,
        refs: 3,
        bytes: 100,
        unmeasured: 1,
        first: at(1),
        last: at(5),
        categories: [
          { category: "question text", events: 2 },
          { category: "wearable summary", events: 1 },
        ],
      },
      {
        recipient: "Oura",
        direction: "sent",
        events: 1,
        syntheticEvents: 0,
        refs: 0,
        bytes: 0,
        unmeasured: 1,
        first: at(3),
        last: at(3),
        categories: [
          { category: "access token", events: 1 },
          { category: "date window", events: 1 },
        ],
      },
    ]);
  });

  test("no rows, no totals", () => {
    expect(ledgerTotals([])).toEqual([]);
  });
});

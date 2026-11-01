import { describe, expect, test } from "bun:test";

import {
  bodyBytes,
  checkRequestText,
  createRecordDisclosure,
  directionLabel,
  type Disclosure,
  disclosureAuditEvent,
  DisclosureNotRecordedError,
  GenomeIdsBlockedError,
  isGenomeIdsBlocked,
  type LedgerEntry,
  ledgerTotals,
  ledgeredFetch,
  modelCallFetch,
  type ModelDisclosure,
  modelRecipient,
  sendDecision,
  telemetryDisclosure,
} from "./disclosure-ledger";
import { type CheckFreeText, GENOME_IDS_BLOCKED_SENTENCE } from "./free-text-check";

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

describe("the free text check of a model request (#346)", () => {
  const BODY = JSON.stringify({
    messages: [{ role: "user", content: "Is rs4988235 in my file?" }],
  });

  test("the row records the kinds and counts found, never the text", async () => {
    const rows: Disclosure[] = [];
    const checked: string[] = [];
    const send = modelCallFetch(fakeFetch([]), {
      recipient: "exoscale",
      modelId: "synthetic/model",
      disclosure: MODEL_CALL,
      record: async (disclosure) => {
        rows.push(disclosure);
        return RECEIPT;
      },
      checkText: async (text) => {
        checked.push(text);
        return { matches: [{ kind: "body scan label", count: 1 }] };
      },
    });
    await send("https://models.invalid/v1/chat", { body: BODY });
    expect(checked).toEqual(["user\nIs rs4988235 in my file?"]);
    expect(rows).toEqual([
      {
        ...MODEL_CALL,
        kind: "hosted-model",
        recipient: "exoscale",
        target: "synthetic/model",
        payloadBytes: Buffer.byteLength(BODY, "utf8"),
        freeText: { matches: [{ kind: "body scan label", count: 1 }] },
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("rs4988235");
  });

  /** A synthetic person's request with no rsID- or site-shaped text. */
  const PLAIN = JSON.stringify({
    messages: [{ role: "user", content: "How did the Demo body sleep?" }],
  });

  const sendWith = (checkText: CheckFreeText, order: string[], rows: Disclosure[]) =>
    modelCallFetch(fakeFetch(order), {
      recipient: "exoscale",
      modelId: "synthetic/model",
      disclosure: MODEL_CALL,
      record: async (disclosure) => {
        order.push("record");
        rows.push(disclosure);
        return RECEIPT;
      },
      checkText,
    });

  test("a failed check on text with no genome shape is not checked and the request goes", async () => {
    const order: string[] = [];
    const rows: Disclosure[] = [];
    const send = sendWith(
      async () => {
        throw new Error("locked");
      },
      order,
      rows,
    );
    await send("https://models.invalid/v1/chat", { body: PLAIN });
    expect(order).toEqual(["record", "send"]);
    expect(rows[0]?.freeText).toBeUndefined();
    expect(rows[0]?.direction).toBeUndefined();
  });

  test("checkRequestText: no checker or an unreadable body is not checked", async () => {
    const found = async () => ({ matches: [] });
    expect(await checkRequestText(undefined, BODY)).toEqual({ status: "not-checked" });
    expect(await checkRequestText(found, new ReadableStream())).toEqual({
      status: "not-checked",
    });
    expect(await checkRequestText(found, BODY)).toEqual({
      status: "checked",
      check: { matches: [] },
    });
  });

  test("checkRequestText: a failed check says whether the text had a genome shape", async () => {
    const fails = async () => {
      throw new Error("locked");
    };
    expect(await checkRequestText(fails, BODY)).toEqual({
      status: "failed",
      genomeShaped: true,
    });
    expect(await checkRequestText(fails, PLAIN)).toEqual({
      status: "failed",
      genomeShaped: false,
    });
  });
  test("the audit row carries the kinds and counts when the check ran", () => {
    expect(
      disclosureAuditEvent({
        ...DISCLOSURE,
        freeText: { matches: [{ kind: "genome site", count: 2 }] },
      }).result,
    ).toEqual({
      direction: "sent",
      categories: ["question text", "wearable summary"],
      bytes: 1234,
      synthetic: false,
      freeText: [{ kind: "genome site", count: 2 }],
    });
  });
});

describe("blocking a request with the person's genome identifiers (#356)", () => {
  const body = (content: string) =>
    JSON.stringify({ messages: [{ role: "user", content }] });

  const run = async (
    content: string,
    check: CheckFreeText,
    record?: () => Promise<never>,
  ) => {
    const order: string[] = [];
    const rows: Disclosure[] = [];
    const send = modelCallFetch(fakeFetch(order), {
      recipient: "exoscale",
      modelId: "synthetic/model",
      disclosure: MODEL_CALL,
      record:
        record ??
        (async (disclosure) => {
          order.push("record");
          rows.push(disclosure);
          return RECEIPT;
        }),
      checkText: check,
    });
    const sent = send("https://models.invalid/v1/chat", { body: body(content) });
    return { order, rows, sent };
  };

  test("an rsID of the person's own blocks the send and the row says blocked", async () => {
    const { order, rows, sent } = await run("Is rs4988235 in my file?", async () => ({
      matches: [{ kind: "rsID", count: 1 }],
    }));
    await expect(sent).rejects.toBeInstanceOf(GenomeIdsBlockedError);
    expect(order).toEqual(["record"]);
    expect(rows).toEqual([
      {
        ...MODEL_CALL,
        kind: "hosted-model",
        direction: "blocked",
        recipient: "exoscale",
        target: "synthetic/model",
        payloadBytes: Buffer.byteLength(body("Is rs4988235 in my file?"), "utf8"),
        freeText: { matches: [{ kind: "rsID", count: 1 }] },
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("rs4988235");
  });

  test("a genome site of the person's own blocks the send", async () => {
    const { order, rows, sent } = await run("What is at chr7:117559590?", async () => ({
      matches: [{ kind: "genome site", count: 1 }],
    }));
    await expect(sent).rejects.toThrow(GENOME_IDS_BLOCKED_SENTENCE);
    expect(order).toEqual(["record"]);
    expect(rows[0]?.direction).toBe("blocked");
    expect(JSON.stringify(rows)).not.toContain("117559590");
  });

  test("a name, file name, scan label or account id is recorded and the request goes", async () => {
    const { order, rows, sent } = await run("How did the Demo body sleep?", async () => ({
      matches: [
        { kind: "file name", count: 1 },
        { kind: "body scan label", count: 1 },
        { kind: "account id", count: 1 },
      ],
    }));
    await sent;
    expect(order).toEqual(["record", "send"]);
    expect(rows[0]?.direction).toBeUndefined();
    expect(rows[0]?.freeText?.matches.length).toBe(3);
  });

  test("an rsID that is not the person's own is not blocked", async () => {
    const { order, sent } = await run("What does rs1801133 do?", async () => ({
      matches: [],
    }));
    await sent;
    expect(order).toEqual(["record", "send"]);
  });

  test("a failed check on rsID- or site-shaped text blocks (fail closed)", async () => {
    for (const content of ["Is rs4988235 in my file?", "What is at 7:117559590?"]) {
      const { order, rows, sent } = await run(content, async () => {
        throw new Error("PersonalDataLockedError");
      });
      await expect(sent).rejects.toBeInstanceOf(GenomeIdsBlockedError);
      expect(order).toEqual(["record"]);
      expect(rows[0]?.direction).toBe("blocked");
      expect(rows[0]?.freeText).toBeUndefined();
    }
  });

  test("a blocked request stays unsent when its row cannot be written", async () => {
    const { order, sent } = await run(
      "Is rs4988235 in my file?",
      async () => ({ matches: [{ kind: "rsID", count: 1 }] }),
      async () => {
        throw new DisclosureNotRecordedError("Error");
      },
    );
    await expect(sent).rejects.toBeInstanceOf(GenomeIdsBlockedError);
    expect(order).toEqual([]);
  });

  test("a model on this machine is never checked or blocked", async () => {
    const order: string[] = [];
    const checked: string[] = [];
    const send = modelCallFetch(fakeFetch(order), {
      recipient: null,
      modelId: "qwen3:4b",
      disclosure: MODEL_CALL,
      record: async () => {
        throw new Error("no ledger row for a local model");
      },
      checkText: async (text) => {
        checked.push(text);
        return { matches: [{ kind: "rsID", count: 1 }] };
      },
    });
    await send("http://127.0.0.1:11434/api/chat", { body: body("rs4988235") });
    expect(order).toEqual(["send"]);
    expect(checked).toEqual([]);
  });

  test("sendDecision: genome kinds block, other kinds and unchecked text do not", () => {
    expect(
      sendDecision({
        status: "checked",
        check: { matches: [{ kind: "rsID", count: 2 }] },
      }),
    ).toEqual({ blocked: true, freeText: { matches: [{ kind: "rsID", count: 2 }] } });
    expect(
      sendDecision({
        status: "checked",
        check: { matches: [{ kind: "file name", count: 1 }] },
      }).blocked,
    ).toBe(false);
    expect(sendDecision({ status: "not-checked" })).toEqual({ blocked: false });
    expect(sendDecision({ status: "failed", genomeShaped: true })).toEqual({
      blocked: true,
    });
    expect(sendDecision({ status: "failed", genomeShaped: false })).toEqual({
      blocked: false,
    });
  });

  test("the audit row of a blocked request says blocked, with kinds and counts", () => {
    expect(
      disclosureAuditEvent({
        ...DISCLOSURE,
        direction: "blocked",
        freeText: { matches: [{ kind: "rsID", count: 1 }] },
      }).result,
    ).toEqual({
      direction: "blocked",
      categories: ["question text", "wearable summary"],
      bytes: 1234,
      synthetic: false,
      freeText: [{ kind: "rsID", count: 1 }],
    });
  });

  test("isGenomeIdsBlocked finds the error itself or wrapped", () => {
    const blocked = new GenomeIdsBlockedError();
    expect(isGenomeIdsBlocked(blocked)).toBe(true);
    expect(isGenomeIdsBlocked(new Error("outer", { cause: blocked }))).toBe(true);
    expect(isGenomeIdsBlocked({ lastError: blocked })).toBe(true);
    expect(isGenomeIdsBlocked(new Error(GENOME_IDS_BLOCKED_SENTENCE))).toBe(false);
    expect(isGenomeIdsBlocked(null)).toBe(false);
  });

  test("directionLabel names each direction", () => {
    expect(["sent", "received", "blocked", "other"].map(directionLabel)).toEqual([
      "Sent",
      "Received",
      "Blocked",
      "Sent",
    ]);
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
  freeTextChecked: false,
  freeTextMatches: null,
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

  test("blocked requests are totalled apart from sent ones (#356)", () => {
    const totals = ledgerTotals([
      row({ ts: at(1) }),
      row({ ts: at(2), direction: "blocked" }),
    ]);
    expect(totals.map((total) => [total.direction, total.events])).toEqual([
      ["blocked", 1],
      ["sent", 1],
    ]);
  });

  test("no rows, no totals", () => {
    expect(ledgerTotals([])).toEqual([]);
  });
});

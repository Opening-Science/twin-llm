import { describe, expect, test } from "bun:test";

import type { Disclosure } from "@/infrastructure/disclosure-ledger";

import { embedText, type EmbedPorts, queryEmbedPorts } from "./embed";

const VECTOR = Array.from({ length: 4 }, (_, index) => index / 10);

const ports = (origin: string, sent: string[]): EmbedPorts => ({
  origin,
  model: "synthetic-embed",
  dim: 4,
  fetch: (async (_url: unknown, init?: RequestInit) => {
    sent.push(String(init?.body ?? ""));
    return Response.json({ embeddings: [VECTOR] });
  }) as unknown as typeof fetch,
});

const call = (record: (disclosure: Disclosure) => Promise<unknown>) => ({
  actor: "local",
  sessionId: "turn-synthetic-1",
  synthetic: false,
  purpose: "knowledge search",
  record: async (disclosure: Disclosure) => {
    await record(disclosure);
    return { seq: 1n, auditSeq: 1n };
  },
});

describe("queryEmbedPorts (#140)", () => {
  test("an Ollama on this machine needs no ledger row", async () => {
    const sent: string[] = [];
    const rows: Disclosure[] = [];
    const base = ports("http://127.0.0.1:11434", sent);
    const wrapped = queryEmbedPorts(
      base,
      call(async (row) => rows.push(row)),
    );
    expect(wrapped).toBe(base);
    expect(await embedText("a synthetic query", "query", wrapped)).toEqual(VECTOR);
    expect(rows).toEqual([]);
  });

  test("an Ollama elsewhere gets the query only after its row is written", async () => {
    const sent: string[] = [];
    const order: string[] = [];
    const rows: Disclosure[] = [];
    const wrapped = queryEmbedPorts(
      ports("http://gpu.internal.invalid:11434", sent),
      call(async (row) => {
        order.push(`ledger after ${sent.length}`);
        rows.push(row);
      }),
    );
    await embedText("a synthetic query", "query", wrapped);
    expect(order).toEqual(["ledger after 0"]);
    expect(rows).toEqual([
      {
        actor: "local",
        sessionId: "turn-synthetic-1",
        kind: "embedding",
        recipient: "ollama on another machine",
        target: "synthetic-embed",
        purpose: "knowledge search",
        categories: ["search text"],
        refs: [],
        payloadBytes: Buffer.byteLength(sent[0] ?? "", "utf8"),
        threadId: null,
        synthetic: false,
      },
    ]);
  });

  test("a failing ledger means the query is never sent and there is no vector", async () => {
    const sent: string[] = [];
    const wrapped = queryEmbedPorts(
      ports("http://gpu.internal.invalid:11434", sent),
      call(async () => {
        throw new Error("ledger down");
      }),
    );
    expect(await embedText("a synthetic query", "query", wrapped)).toBe(null);
    expect(sent).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";

import {
  appendDisclosureInTransaction,
  checkDisclosureChain,
  type DisclosureChainRow,
  type NewDisclosureRow,
} from "./disclosure-chain";

type Stored = DisclosureChainRow & Readonly<{ refs: string | null }>;

/** An in-memory `disclosure_events` table behind the transaction API. */
const fakeTable = () => {
  const rows: Stored[] = [];
  const tx = {
    $executeRaw: async () => 0,
    disclosureEvent: {
      findFirst: async () => rows.at(-1) ?? null,
      create: async ({ data }: { data: Stored }) => {
        rows.push(data);
        return data;
      },
    },
  };
  return { rows, tx: tx as never };
};

const entry = (index: number): NewDisclosureRow => ({
  id: `row-${index}`,
  ts: new Date(Date.UTC(2026, 9, 31, 12, index)),
  actor: "user_synthetic_1",
  kind: "hosted-model",
  direction: "sent",
  recipient: "exoscale",
  target: "swiss-ai/Apertus-8B-Instruct-2509",
  purpose: "chat answer",
  categories: ["question text", "wearable summary"],
  refCount: 2,
  payloadBytes: 1000 + index,
  threadId: "thread-synthetic-1",
  synthetic: false,
  freeTextChecked: false,
  refs: `sealed-${index}`,
  auditSeq: BigInt(10 + index),
});

const seeded = async (count: number) => {
  const table = fakeTable();
  for (let index = 0; index < count; index += 1) {
    await appendDisclosureInTransaction(table.tx, entry(index));
  }
  return table;
};

describe("the disclosure ledger chain (#140)", () => {
  test("rows are numbered and linked, and the chain verifies", async () => {
    const { rows } = await seeded(3);
    expect(rows.map((row) => row.seq)).toEqual([1n, 2n, 3n]);
    expect(rows[1]?.prevHash).toBe(rows[0]?.hash);
    expect(checkDisclosureChain(rows)).toEqual({
      ok: true,
      brokenAtSeq: null,
      checked: 3,
      total: 3,
      latestHash: rows[2]?.hash ?? null,
    });
  });

  test("an edited recipient, count, size or label breaks the chain at that row", async () => {
    const { rows } = await seeded(3);
    const edits: readonly Partial<Stored>[] = [
      { recipient: "openrouter" },
      { refCount: 0 },
      { payloadBytes: null },
      { synthetic: true },
      { categories: ["question text"] },
      { auditSeq: 99n },
    ];
    for (const edit of edits) {
      const tampered = rows.map((row, index) =>
        index === 1 ? { ...row, ...edit } : row,
      );
      expect([edit, checkDisclosureChain(tampered).brokenAtSeq]).toEqual([edit, 2]);
    }
  });

  test("a removed row breaks the link of the row after it", async () => {
    const { rows } = await seeded(3);
    expect(checkDisclosureChain([rows[0], rows[2]] as Stored[]).brokenAtSeq).toBe(3);
  });

  test("the sealed references are outside the hash, so a key rotation can reseal them", async () => {
    const { rows } = await seeded(2);
    const resealed = rows.map((row) => ({ ...row, refs: `${row.refs}-new-key` }));
    expect(checkDisclosureChain(resealed).ok).toBe(true);
  });

  test("an empty ledger holds, with nothing checked", () => {
    expect(checkDisclosureChain([])).toEqual({
      ok: true,
      brokenAtSeq: null,
      checked: 0,
      total: 0,
      latestHash: null,
    });
  });
});

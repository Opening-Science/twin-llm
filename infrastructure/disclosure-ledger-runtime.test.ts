import { describe, expect, test } from "bun:test";

import { checkDisclosureChain } from "@/packages/audit/disclosure-chain";
import { sha256Hex, toCanonicalJson } from "@/packages/audit/hash";
import { checkChain } from "@/packages/audit/verify-chain";

import { createDisclosureWriter } from "./disclosure-ledger-runtime";
import {
  createRecordDisclosure,
  type Disclosure,
  disclosureAuditEvent,
} from "./disclosure-ledger";
import { openJson, sealedCipher } from "./field-cipher";
import { PersonalDataLockedError } from "./field-cipher-runtime";

const KEY_ID = ["01234567", "89abcdef"].join("");
const cipher = sealedCipher({ keyId: KEY_ID, dataKey: Buffer.alloc(32, 7) });

const DISCLOSURE: Disclosure = {
  actor: "user_synthetic_1",
  sessionId: "turn-synthetic-1",
  kind: "hosted-model",
  recipient: "exoscale",
  target: "swiss-ai/Apertus-8B-Instruct-2509",
  purpose: "chat answer",
  categories: ["question text", "wearable summary"],
  refs: [
    { source: "wearable", key: "oura.sleep.score.2026-01-01" },
    { source: "wearable", key: "oura.hrv.2026-01-01" },
  ],
  payloadBytes: 2048,
  threadId: "thread-synthetic-1",
  synthetic: false,
};

type Row = Record<string, unknown> & { seq: bigint; hash: string };

/**
 * Two in-memory tables behind Prisma's interactive transaction: rows are
 * kept only when the whole callback succeeds, as Postgres would.
 */
const fakeDatabase = (options: Readonly<{ failLedger?: boolean }> = {}) => {
  const audit: Row[] = [];
  const ledger: Row[] = [];
  const client = {
    $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => {
      const auditDraft = [...audit];
      const ledgerDraft = [...ledger];
      const tx = {
        $executeRaw: async () => 0,
        auditEvent: {
          findFirst: async () => auditDraft.at(-1) ?? null,
          create: async ({ data }: { data: Row }) => {
            auditDraft.push(data);
            return data;
          },
        },
        disclosureEvent: {
          findFirst: async () => ledgerDraft.at(-1) ?? null,
          create: async ({ data }: { data: Row }) => {
            if (options.failLedger === true) throw new Error("ledger table missing");
            ledgerDraft.push(data);
            return data;
          },
        },
      };
      const result = await run(tx);
      audit.splice(0, audit.length, ...auditDraft);
      ledger.splice(0, ledger.length, ...ledgerDraft);
      return result;
    },
  };
  return { audit, ledger, client: () => client as never };
};

describe("createDisclosureWriter (#140)", () => {
  test("writes the audit row and the ledger row together, paired by seq", async () => {
    const db = fakeDatabase();
    const record = createRecordDisclosure(
      createDisclosureWriter(db.client, () => cipher),
    );
    expect(await record(DISCLOSURE)).toEqual({ seq: 1n, auditSeq: 1n });
    expect(await record({ ...DISCLOSURE, refs: [] })).toEqual({ seq: 2n, auditSeq: 2n });
    expect(db.audit.map((row) => row.tool)).toEqual([
      "disclosure.hosted-model",
      "disclosure.hosted-model",
    ]);
    expect(
      db.ledger.map((row) => [row.auditSeq, row.refCount, row.freeTextChecked]),
    ).toEqual([
      [1n, 2, false],
      [2n, 0, false],
    ]);
    expect(checkChain(db.audit as never).ok).toBe(true);
    expect(checkDisclosureChain(db.ledger as never).ok).toBe(true);
  });

  test("a checked request stores the kinds and counts found (#346)", async () => {
    const db = fakeDatabase();
    const record = createRecordDisclosure(
      createDisclosureWriter(db.client, () => cipher),
    );
    await record({ ...DISCLOSURE, freeText: { matches: [{ kind: "rsID", count: 1 }] } });
    await record({ ...DISCLOSURE, freeText: { matches: [] } });
    expect(
      db.ledger.map((row) => [row.freeTextChecked, row.freeTextMatches ?? null]),
    ).toEqual([
      [true, [{ kind: "rsID", count: 1 }]],
      [true, []],
    ]);
    expect(checkDisclosureChain(db.ledger as never).ok).toBe(true);
  });

  test("a blocked request writes ledger and audit rows that say blocked (#356)", async () => {
    const db = fakeDatabase();
    const record = createRecordDisclosure(
      createDisclosureWriter(db.client, () => cipher),
    );
    const blocked: Disclosure = {
      ...DISCLOSURE,
      direction: "blocked",
      freeText: { matches: [{ kind: "rsID", count: 2 }] },
    };
    await record(blocked);
    expect(
      db.ledger.map((row) => [row.direction, row.freeTextChecked, row.freeTextMatches]),
    ).toEqual([["blocked", true, [{ kind: "rsID", count: 2 }]]]);
    // The audit row stores its result's hash: the result that says blocked.
    const audit = disclosureAuditEvent(blocked);
    expect(audit.result).toMatchObject({ direction: "blocked" });
    expect(db.audit.map((row) => row.resultSha256)).toEqual([
      sha256Hex(toCanonicalJson(audit.result)),
    ]);
    expect(checkDisclosureChain(db.ledger as never).ok).toBe(true);
  });

  test("the value references are sealed with the person's key, never stored in clear", async () => {
    const db = fakeDatabase();
    const record = createRecordDisclosure(
      createDisclosureWriter(db.client, () => cipher),
    );
    await record(DISCLOSURE);
    const stored = db.ledger[0];
    expect(String(stored?.refs).startsWith("tlenc1.")).toBe(true);
    const text = (rows: readonly Row[]) =>
      JSON.stringify(rows, (_key, value: unknown) =>
        typeof value === "bigint" ? String(value) : value,
      );
    expect(text(db.ledger)).not.toContain("oura.sleep");
    expect(text(db.audit)).not.toContain("oura.sleep");
    expect(
      openJson(
        cipher,
        "disclosure_events",
        "refs",
        String(stored?.id),
        String(stored?.refs),
      ),
    ).toEqual(DISCLOSURE.refs);
  });

  test("a row with no references needs no key, so it can be written while locked", async () => {
    const db = fakeDatabase();
    const record = createRecordDisclosure(
      createDisclosureWriter(db.client, () => {
        throw new PersonalDataLockedError();
      }),
    );
    await record({ ...DISCLOSURE, kind: "vendor-auth", refs: [] });
    expect(db.ledger.map((row) => row.refs)).toEqual([null]);
    await expect(record(DISCLOSURE)).rejects.toThrow(
      "The disclosure ledger could not be written",
    );
    expect(db.ledger.length).toBe(1);
  });

  test("when the ledger row fails, the audit row is not kept either", async () => {
    const db = fakeDatabase({ failLedger: true });
    const record = createRecordDisclosure(
      createDisclosureWriter(db.client, () => cipher),
    );
    await expect(record(DISCLOSURE)).rejects.toThrow(
      "The disclosure ledger could not be written",
    );
    expect(db.audit).toEqual([]);
    expect(db.ledger).toEqual([]);
  });
});

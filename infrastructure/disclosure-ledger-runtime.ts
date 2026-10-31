import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { appendInTransaction } from "@/packages/audit/append";
import {
  appendDisclosureInTransaction,
  checkDisclosureChain,
} from "@/packages/audit/disclosure-chain";
import type { VerifyChainResult } from "@/packages/audit/chain";

import { database } from "./database";
import {
  createRecordDisclosure,
  type DisclosureWriter,
  type LedgerEntry,
  type RecordDisclosure,
  type ValueRef,
} from "./disclosure-ledger";
import { type FieldCipher, newRowId, openJson, sealJson } from "./field-cipher";
import { cipherForActor } from "./field-cipher-runtime";

/**
 * The disclosure ledger against the database (#140). `recordDisclosure` is
 * the one function every outbound path calls before it sends: it seals the
 * value references with the person's key (#141; only when there are any, so
 * a vendor's OAuth return can be recorded while the vault is locked), then
 * writes the paired audit row and the ledger row in one transaction, with
 * what the free text check found (#346) when the caller ran it. If any
 * of it fails, it rejects and the caller does not send.
 */

const TABLE = "disclosure_events";
const REFS = "refs";

export const createDisclosureWriter =
  (
    client: () => PrismaClient,
    cipherOf: (actor: string) => FieldCipher = cipherForActor,
  ): DisclosureWriter =>
  async (disclosure, audit) => {
    const id = newRowId();
    const refs =
      disclosure.refs.length === 0
        ? null
        : sealJson(cipherOf(disclosure.actor), TABLE, REFS, id, disclosure.refs);
    return client().$transaction(async (tx) => {
      const audited = await appendInTransaction(tx, audit);
      const row = await appendDisclosureInTransaction(tx, {
        id,
        ts: new Date(),
        actor: disclosure.actor,
        kind: disclosure.kind,
        direction: disclosure.direction ?? "sent",
        recipient: disclosure.recipient,
        target: disclosure.target,
        purpose: disclosure.purpose,
        categories: disclosure.categories,
        refCount: disclosure.refs.length,
        payloadBytes: disclosure.payloadBytes,
        threadId: disclosure.threadId,
        synthetic: disclosure.synthetic,
        freeTextChecked: disclosure.freeText !== undefined,
        freeTextMatches: disclosure.freeText?.matches ?? null,
        refs,
        auditSeq: audited.seq,
      });
      return { seq: row.seq, auditSeq: audited.seq };
    });
  };

// The database and cipher are looked up at each call, not bound here.
export const recordDisclosure: RecordDisclosure = createRecordDisclosure(
  createDisclosureWriter(
    () => database(),
    (actor) => cipherForActor(actor),
  ),
);

const ENTRY_FIELDS = {
  seq: true,
  ts: true,
  kind: true,
  direction: true,
  recipient: true,
  target: true,
  purpose: true,
  categories: true,
  refCount: true,
  payloadBytes: true,
  threadId: true,
  synthetic: true,
  freeTextChecked: true,
  freeTextMatches: true,
} as const;

/** One person's ledger rows, newest first, without the sealed references. */
export const ledgerEntriesOf = async (
  actor: string,
  take?: number,
): Promise<readonly LedgerEntry[]> =>
  database().disclosureEvent.findMany({
    where: { actor },
    orderBy: { seq: "desc" },
    select: ENTRY_FIELDS,
    ...(take === undefined ? {} : { take }),
  });

export type LedgerEntryWithRefs = LedgerEntry & Readonly<{ refs: readonly ValueRef[] }>;

/**
 * One person's latest rows with their value references opened; needs their
 * vault open (a synthetic install's rows are plain).
 */
export const ledgerEntriesWithRefs = async (
  actor: string,
  take: number,
): Promise<readonly LedgerEntryWithRefs[]> => {
  const rows = await database().disclosureEvent.findMany({
    where: { actor },
    orderBy: { seq: "desc" },
    select: { ...ENTRY_FIELDS, id: true, refs: true },
    take,
  });
  if (rows.every((row) => row.refs === null)) {
    return rows.map(({ id: _id, refs: _refs, ...entry }) => ({ ...entry, refs: [] }));
  }
  const cipher: FieldCipher = cipherForActor(actor);
  return rows.map(({ id, refs, ...entry }) => ({
    ...entry,
    refs:
      refs === null
        ? []
        : (openJson(cipher, TABLE, REFS, id, refs) as readonly ValueRef[]),
  }));
};

/** Every row's chain fields, in order; reads no sealed column. */
export const verifyLedger = async (): Promise<VerifyChainResult> =>
  checkDisclosureChain(
    await database().disclosureEvent.findMany({
      orderBy: { seq: "asc" },
      omit: { refs: true },
    }),
  );

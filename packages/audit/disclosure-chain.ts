import type { PrismaClient } from "@/generated/prisma/client";

import { checkLinks, hashLink, nextLink, type VerifyChainResult } from "./chain";

/**
 * The disclosure ledger's chain (#140): the same hash and walk as the audit
 * log (`chain.ts`) over its own row. The hash covers every column but the
 * sealed `refs`, which a key rotation rewrites; `ref_count` stands for it,
 * and the sealed value is bound to its row by its encryption context.
 */

export type DisclosureChainRow = Readonly<{
  seq: bigint | number;
  id: string;
  ts: Date;
  actor: string;
  kind: string;
  direction: string;
  recipient: string;
  target: string | null;
  purpose: string;
  categories: readonly string[];
  refCount: number;
  payloadBytes: number | null;
  threadId: string | null;
  synthetic: boolean;
  freeTextChecked: boolean;
  auditSeq: bigint | number;
  prevHash: string;
  hash: string;
}>;

/** The fields one new row adds; `seq`, the links and the hash come from the chain. */
export type NewDisclosureRow = Omit<DisclosureChainRow, "seq" | "prevHash" | "hash"> &
  Readonly<{ refs: string | null }>;

export const canonicalDisclosure = (
  row: Omit<DisclosureChainRow, "hash">,
): Readonly<Record<string, unknown>> => ({
  actor: row.actor,
  audit_seq: Number(row.auditSeq),
  categories: [...row.categories],
  direction: row.direction,
  free_text_checked: row.freeTextChecked,
  id: row.id,
  kind: row.kind,
  payload_bytes: row.payloadBytes,
  prev_hash: row.prevHash,
  purpose: row.purpose,
  recipient: row.recipient,
  ref_count: row.refCount,
  seq: Number(row.seq),
  synthetic: row.synthetic,
  target: row.target,
  thread_id: row.threadId,
  ts: row.ts.toISOString(),
});

export const disclosureRowHash = (row: Omit<DisclosureChainRow, "hash">): string =>
  hashLink(row.prevHash, canonicalDisclosure(row));

/** Rows must already be in ascending `seq` order. */
export const checkDisclosureChain = (
  rows: readonly DisclosureChainRow[],
): VerifyChainResult => checkLinks(rows, disclosureRowHash);

export type DisclosureTransaction = Pick<PrismaClient, "disclosureEvent" | "$executeRaw">;

/** Appends one ledger row inside the caller's transaction, under the ledger's own lock. */
export const appendDisclosureInTransaction = async (
  tx: DisclosureTransaction,
  row: NewDisclosureRow,
): Promise<Readonly<{ seq: bigint; hash: string }>> => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('disclosure_events'))`;
  const last = await tx.disclosureEvent.findFirst({
    orderBy: { seq: "desc" },
    select: { seq: true, hash: true },
  });
  const { seq, prevHash } = nextLink(last);
  const hash = disclosureRowHash({ ...row, seq, prevHash });
  await tx.disclosureEvent.create({
    data: {
      ...row,
      categories: [...row.categories],
      auditSeq: BigInt(row.auditSeq),
      seq,
      prevHash,
      hash,
    },
  });
  return { seq, hash };
};

export const verifyDisclosureChain = async (
  client: PrismaClient,
): Promise<VerifyChainResult> =>
  checkDisclosureChain(
    await client.disclosureEvent.findMany({
      orderBy: { seq: "asc" },
      omit: { refs: true },
    }),
  );

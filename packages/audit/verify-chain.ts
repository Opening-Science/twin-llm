import type { PrismaClient } from "@/generated/prisma/client";

import { checkLinks, firstBrokenLink, type VerifyChainResult } from "./chain";
import { GENESIS_PREV_HASH, hashEvent } from "./hash";

/**
 * Recomputes every row's hash in `seq` order and checks each row points at
 * the one before. `checkChain` is the pure walk over rows already read;
 * `verifyChain` reads the table and runs it.
 *
 * `checked` counts the rows looked at, up to and including a broken one.
 * `latestHash` is the hash stored on the newest row, whether or not the chain
 * holds, so a reader can note it and compare later.
 */

export type { VerifyChainResult };

export type ChainRow = Readonly<{
  seq: bigint | number;
  ts: Date;
  actor: string;
  sessionId: string;
  subjectRef: string | null;
  tool: string;
  argsSha256: string;
  resultSha256: string;
  rowCount: number;
  prevHash: string;
  hash: string;
}>;

/** A row's hash recomputed from its fields; the chain is in `chain.ts`. */
export const auditRowHash = (row: ChainRow): string =>
  hashEvent({
    actor: row.actor,
    args_sha256: row.argsSha256,
    prev_hash: row.prevHash,
    result_sha256: row.resultSha256,
    row_count: row.rowCount,
    seq: Number(row.seq),
    session_id: row.sessionId,
    subject_ref: row.subjectRef,
    tool: row.tool,
    ts: row.ts.toISOString(),
  });

/**
 * The index of the first row in `rows` that does not hash or does not point
 * at the row before (`prevHash` for the first), or -1. Lets a caller walk the
 * chain one page at a time, carrying the last hash between pages.
 */
export const firstBrokenIndex = (
  rows: readonly ChainRow[],
  prevHash: string = GENESIS_PREV_HASH,
): number => firstBrokenLink(rows, auditRowHash, prevHash);

/** Rows must already be in ascending `seq` order. */
export const checkChain = (rows: readonly ChainRow[]): VerifyChainResult =>
  checkLinks(rows, auditRowHash);

export const verifyChain = async (client: PrismaClient): Promise<VerifyChainResult> =>
  checkChain(await client.auditEvent.findMany({ orderBy: { seq: "asc" } }));

import type { PrismaClient } from "@/generated/prisma/client";

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

export type VerifyChainResult = (
  | { readonly ok: true; readonly brokenAtSeq: null }
  | { readonly ok: false; readonly brokenAtSeq: number }
) & {
  readonly checked: number;
  readonly total: number;
  readonly latestHash: string | null;
};

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

const rowIsSound = (row: ChainRow, expectedPrev: string): boolean =>
  row.prevHash === expectedPrev &&
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
  }) === row.hash;

/** Rows must already be in ascending `seq` order. */
export const checkChain = (rows: readonly ChainRow[]): VerifyChainResult => {
  const total = rows.length;
  const latestHash = rows.at(-1)?.hash ?? null;
  const brokenIndex = rows.findIndex(
    (row, index) =>
      !rowIsSound(row, index === 0 ? GENESIS_PREV_HASH : rows[index - 1].hash),
  );
  return brokenIndex === -1
    ? { ok: true, brokenAtSeq: null, checked: total, total, latestHash }
    : {
        ok: false,
        brokenAtSeq: Number(rows[brokenIndex].seq),
        checked: brokenIndex + 1,
        total,
        latestHash,
      };
};

export const verifyChain = async (client: PrismaClient): Promise<VerifyChainResult> =>
  checkChain(await client.auditEvent.findMany({ orderBy: { seq: "asc" } }));

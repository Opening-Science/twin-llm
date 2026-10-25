import type { PrismaClient } from "@/generated/prisma/client";

import { GENESIS_PREV_HASH, hashEvent } from "./hash";

export type VerifyChainResult =
  | { readonly ok: true; readonly brokenAtSeq: null }
  | { readonly ok: false; readonly brokenAtSeq: number };

export const verifyChain = async (client: PrismaClient): Promise<VerifyChainResult> => {
  const events = await client.auditEvent.findMany({
    orderBy: { seq: "asc" },
  });

  let expectedPrev = GENESIS_PREV_HASH;
  for (const event of events) {
    const recomputed = hashEvent({
      actor: event.actor,
      args_sha256: event.argsSha256,
      prev_hash: event.prevHash,
      result_sha256: event.resultSha256,
      row_count: event.rowCount,
      seq: Number(event.seq),
      session_id: event.sessionId,
      subject_ref: event.subjectRef,
      tool: event.tool,
      ts: event.ts.toISOString(),
    });
    if (event.prevHash !== expectedPrev || recomputed !== event.hash) {
      return { ok: false, brokenAtSeq: Number(event.seq) };
    }
    expectedPrev = event.hash;
  }

  return { ok: true, brokenAtSeq: null };
};

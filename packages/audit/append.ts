import type { PrismaClient } from "@/generated/prisma/client";

import { GENESIS_PREV_HASH, hashEvent, sha256Hex, toCanonicalJson } from "./hash";

export type AppendInput = {
  readonly actor: string;
  readonly sessionId: string;
  readonly subjectRef: string | null;
  readonly tool: string;
  readonly args: unknown;
  readonly result: unknown;
  readonly rowCount: number;
};

export type AppendedEvent = {
  readonly seq: bigint;
  readonly hash: string;
  readonly argsSha256: string;
  readonly resultSha256: string;
};

export const append = async (
  client: PrismaClient,
  input: AppendInput,
): Promise<AppendedEvent> => {
  const argsSha256 = sha256Hex(toCanonicalJson(input.args));
  const resultSha256 = sha256Hex(toCanonicalJson(input.result));

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('audit_events'))`;
    const last = await tx.auditEvent.findFirst({ orderBy: { seq: "desc" } });
    const prevHash = last?.hash ?? GENESIS_PREV_HASH;
    const seq = last ? last.seq + BigInt(1) : BigInt(1);
    const ts = new Date();
    const hash = hashEvent({
      actor: input.actor,
      args_sha256: argsSha256,
      prev_hash: prevHash,
      result_sha256: resultSha256,
      row_count: input.rowCount,
      seq: Number(seq),
      session_id: input.sessionId,
      subject_ref: input.subjectRef,
      tool: input.tool,
      ts: ts.toISOString(),
    });

    await tx.auditEvent.create({
      data: {
        seq,
        ts,
        actor: input.actor,
        sessionId: input.sessionId,
        subjectRef: input.subjectRef,
        tool: input.tool,
        argsSha256,
        resultSha256,
        rowCount: input.rowCount,
        prevHash,
        hash,
      },
    });

    return { seq, hash, argsSha256, resultSha256 };
  });
};

import "server-only";

import { database } from "@/infrastructure/database";
import {
  isGenomeAuditTool,
  toolPartsUseGenome,
} from "@/infrastructure/genome-thread-policy";
import {
  DNA_ASK_AUDIT_TOOL,
  GENOME_REPORT_AUDIT_TOOL,
} from "@/packages/carbon-x/constants";

import type { GenomeThread } from "./start-answer";

/**
 * Whether the thread of a turn is genome-personal (#151): any stored answer in
 * it has a `genome_report` or `dna_ask` tool part, or the audit chain has a
 * genome tool row for any of its turns (that also covers an answer whose
 * parts were not stored). The thread is read whole, every model's answers
 * included. A turn that does not exist is an error, never "not genome".
 */
export const loadGenomeThread = async (turnId: string): Promise<GenomeThread> => {
  const turn = await database().turn.findUnique({
    where: { id: turnId },
    select: {
      threadId: true,
      thread: {
        select: {
          turns: {
            select: { id: true, responses: { select: { toolParts: true } } },
          },
        },
      },
    },
  });
  if (turn === null) throw new Error("genome thread check: turn not found");

  const turns = turn.thread.turns;
  if (
    turns.some((each) => each.responses.some((row) => toolPartsUseGenome(row.toolParts)))
  ) {
    return { threadId: turn.threadId, usedGenome: true };
  }
  const genomeRow = await database().auditEvent.findFirst({
    where: {
      sessionId: { in: turns.map((each) => each.id) },
      tool: { in: [GENOME_REPORT_AUDIT_TOOL, DNA_ASK_AUDIT_TOOL] },
    },
    select: { tool: true },
  });
  return {
    threadId: turn.threadId,
    usedGenome: genomeRow !== null && isGenomeAuditTool(genomeRow.tool),
  };
};

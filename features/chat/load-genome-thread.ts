import "server-only";

import { database } from "@/infrastructure/database";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";
import {
  isGenomeAuditTool,
  LOCAL_ONLY_AUDIT_TOOLS,
  toolPartsUseGenome,
} from "@/infrastructure/genome-thread-policy";
import { openResponse } from "@/infrastructure/thread-fields";

import type { GenomeThread } from "./start-answer";

/**
 * Whether the thread of a turn is genome-personal (#151): any stored answer in
 * it has a `genome_report` or `dna_ask` tool part (or an imported-data tool
 * part, #181), or the audit chain has a
 * genome tool row for any of its turns (that also covers an answer whose
 * parts were not stored). The thread is read whole, every model's answers
 * included. A turn that does not exist is an error, never "not genome".
 */
export const loadGenomeThread = async (turnId: string): Promise<GenomeThread> => {
  const exchange = await database().exchange.findUnique({
    where: { id: turnId },
    select: {
      conversationId: true,
      conversation: {
        select: {
          ownerId: true,
          exchanges: {
            select: {
              id: true,
              answers: { select: { id: true, toolTraceSealed: true } },
            },
          },
        },
      },
    },
  });
  if (exchange === null) throw new Error("genome thread check: turn not found");

  const exchanges = exchange.conversation.exchanges;
  const cipher = await cipherForUser(exchange.conversation.ownerId);
  if (
    exchanges.some((each) =>
      each.answers.some((row) =>
        toolPartsUseGenome(
          openResponse(cipher, { id: row.id, toolParts: row.toolTraceSealed }).toolParts,
        ),
      ),
    )
  ) {
    return { threadId: exchange.conversationId, usedGenome: true };
  }
  const genomeRow = await database().auditEvent.findFirst({
    where: {
      sessionId: { in: exchanges.map((each) => each.id) },
      tool: { in: [...LOCAL_ONLY_AUDIT_TOOLS] },
    },
    select: { tool: true },
  });
  return {
    threadId: exchange.conversationId,
    usedGenome: genomeRow !== null && isGenomeAuditTool(genomeRow.tool),
  };
};

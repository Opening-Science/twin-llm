import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";

import { KNOWLEDGE_SOURCE } from "./constants";

/** Removes knowledge documents (and, by cascade, chunks) whose file is gone. */
export const pruneKnowledgeDocuments = async (
  db: PrismaClient,
  keepIds: readonly string[],
): Promise<number> => {
  const { count } = await db.guidelineDocument.deleteMany({
    where: { source: KNOWLEDGE_SOURCE, id: { notIn: [...keepIds] } },
  });
  return count;
};

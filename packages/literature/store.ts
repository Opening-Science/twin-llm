import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Removes literature documents (and, by cascade, chunks) in the given sources
 * whose files are gone. Other sources are never touched.
 */
export const pruneLiteratureDocuments = async (
  db: PrismaClient,
  sources: readonly string[],
  keepIds: readonly string[],
): Promise<number> => {
  const { count } = await db.guidelineDocument.deleteMany({
    where: { source: { in: [...sources] }, id: { notIn: [...keepIds] } },
  });
  return count;
};

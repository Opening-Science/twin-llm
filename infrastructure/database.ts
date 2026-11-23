import "server-only";

import { PrismaClient } from "@/generated/prisma/client";

import { postgresAdapter } from "./database-adapter";
import { serverEnv } from "./env";
import { processSingleton } from "./process-singleton";

/**
 * The Prisma client for this server process.
 *
 * Each client owns a pg pool, so building one per call would open a new pool
 * for every query. `processSingleton` keeps exactly one, in development and
 * production alike. The client is built on first call rather than at import,
 * so `next build` can load route modules without a DATABASE_URL.
 */
const openClient = (): PrismaClient => {
  const adapter = postgresAdapter(serverEnv().DATABASE_URL);
  return new PrismaClient({ adapter });
};

export const database: () => PrismaClient = processSingleton(
  "__twinLlmPrismaClient",
  openClient,
);

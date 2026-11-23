import { PrismaPg } from "@prisma/adapter-pg";

/**
 * The session setting every app connection opens with. `@prisma/adapter-pg`
 * writes a Date as a UTC wall-clock time with no offset and, reading a
 * `timestamptz`, drops the offset Postgres sends and keeps the wall-clock
 * time. Both are right only when the session time zone is UTC, and a local
 * cluster defaults to the machine's zone (Europe/Zurich on ours).
 */
export const UTC_SESSION = "-c TimeZone=UTC";

/** The Prisma adapter for one Postgres connection string, in a UTC session. */
export const postgresAdapter = (connectionString: string): PrismaPg =>
  new PrismaPg({ connectionString, options: UTC_SESSION });

import { PrismaPg } from "@prisma/adapter-pg";

/**
 * The session setting every app connection opens with. `@prisma/adapter-pg`
 * writes a Date as a UTC wall-clock time with no offset and, reading a
 * `timestamptz`, drops the offset Postgres sends and keeps the wall-clock
 * time. Both are right only when the session time zone is UTC, and a local
 * cluster defaults to the machine's zone (Europe/Zurich on ours).
 */
export const UTC_SESSION = "-c TimeZone=UTC";

export type ConnectionConfig = Readonly<{ connectionString: string; options: string }>;

/**
 * The pg config for a connection string, in a UTC session. pg lets an
 * `options` parameter in the string replace the config's, so it is moved out
 * of the string and kept, with UTC last so that it wins.
 */
export const connectionConfig = (connectionString: string): ConnectionConfig => {
  const at = connectionString.indexOf("?");
  if (at === -1) return { connectionString, options: UTC_SESSION };
  const params = new URLSearchParams(connectionString.slice(at + 1));
  const own = (params.get("options") ?? "").trim();
  params.delete("options");
  const rest = params.toString();
  const base = connectionString.slice(0, at);
  return {
    connectionString: rest === "" ? base : `${base}?${rest}`,
    options: own === "" ? UTC_SESSION : `${own} ${UTC_SESSION}`,
  };
};

/** The Prisma adapter for one Postgres connection string, in a UTC session. */
export const postgresAdapter = (connectionString: string): PrismaPg =>
  new PrismaPg(connectionConfig(connectionString));

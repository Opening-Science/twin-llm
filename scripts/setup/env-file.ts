/**
 * Pure helpers for `.env.local` and `DATABASE_URL`. Setup creates `.env.local`
 * from `.env.synthetic.example` only when there is none; it never edits one
 * that exists.
 */
import { parseDatabaseConnection } from "../../infrastructure/storage-hardening";
import type { Platform } from "./prerequisites";

/** `KEY=value` lines of a dotenv file; comments and blank lines are skipped. */
export const parseEnvFile = (text: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        const key = line
          .slice(0, at)
          .replace(/^export\s+/, "")
          .trim();
        const raw = line.slice(at + 1).trim();
        const value = /^(["']).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
        return [key, value] as const;
      }),
  );

/** The placeholder URL in `.env.synthetic.example`, which no server accepts. */
export const EXAMPLE_DATABASE_URL =
  "postgresql://user:password@127.0.0.1:5432/twin_llm_synthetic";

/**
 * The `DATABASE_URL` a new `.env.local` gets: the one in the shell when set;
 * on macOS Homebrew's default (the login user, no password); otherwise the
 * example's placeholder, which the checklist then asks the person to edit.
 */
export const defaultDatabaseUrl = (
  platform: Platform,
  shellUrl: string | undefined,
  user: string,
): string => {
  if (shellUrl) return shellUrl;
  if (platform === "darwin" && /^[A-Za-z0-9._-]+$/.test(user)) {
    return `postgresql://${user}@127.0.0.1:5432/twin_llm_synthetic`;
  }
  return EXAMPLE_DATABASE_URL;
};

/** The example file with its `DATABASE_URL` line replaced. */
export const envFileFromExample = (example: string, databaseUrl: string): string =>
  example
    .split("\n")
    .map((line) =>
      line.startsWith("DATABASE_URL=") ? `DATABASE_URL=${databaseUrl}` : line,
    )
    .join("\n");

export type DatabaseTarget = Readonly<{
  /** The database named in the URL. */
  name: string;
  /** The same server and credentials, on the `postgres` maintenance database. */
  maintenanceUrl: string;
}>;

/** Database names setup is willing to create: plain identifiers only. */
const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/** The database a URL points at, or null when it is not a postgres URL with a plain name. */
export const databaseTarget = (url: string): DatabaseTarget | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") return null;
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!SAFE_NAME.test(name)) return null;
  const maintenance = new URL(parsed.toString());
  maintenance.pathname = "/postgres";
  return { name, maintenanceUrl: maintenance.toString() };
};

/** The URL with any password replaced, for printing. */
export const redactUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "(not a URL)";
  }
};

/** Options for Bun's SQL client to reach a Unix socket, which it does not read from a URL. */
export type SocketOptions = Readonly<{
  /** The socket file itself: `<folder>/.s.PGSQL.<port>`. */
  path: string;
  username: string | undefined;
  password: string | undefined;
  database: string | undefined;
}>;

/**
 * For a socket URL (`host=/folder` in the query, or a `%2F...` host), the
 * options Bun's SQL client needs; null for a TCP URL, which it reads as is.
 */
export const socketOptions = (url: string): SocketOptions | null => {
  const connection = parseDatabaseConnection(url);
  if (connection.kind !== "socket") return null;
  const parsed = URL.canParse(url)
    ? new URL(url)
    : new URL(url.replace("@/", "@dummy-host.invalid/"));
  const password =
    parsed.searchParams.get("password") ?? decodeURIComponent(parsed.password);
  return {
    path: `${connection.socketDir}/.s.PGSQL.${connection.port}`,
    username: connection.user ?? undefined,
    password: password === "" ? undefined : password,
    database: connection.database ?? undefined,
  };
};

/** Connection settings as options: a socket `path`, or `hostname` and `port`. */
export type ConnectOptions =
  | SocketOptions
  | Readonly<{
      hostname: string;
      port: number;
      username: string | undefined;
      password: string | undefined;
      database: string | undefined;
    }>;

/**
 * The same server, role and database with an empty password, for the probe
 * that catches `trust` (#144). Null when the URL cannot be read.
 */
export const withoutPassword = (url: string): ConnectOptions | null => {
  const socket = socketOptions(url);
  if (socket !== null) return { ...socket, password: "" };
  const connection = parseDatabaseConnection(url);
  if (connection.kind !== "tcp") return null;
  return {
    hostname: connection.host.replace(/^\[|\]$/g, ""),
    port: connection.port,
    username: connection.user ?? undefined,
    password: "",
    database: connection.database ?? undefined,
  };
};

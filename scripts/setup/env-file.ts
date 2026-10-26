/**
 * Pure helpers for `.env.local` and `DATABASE_URL`. Setup creates `.env.local`
 * from `.env.synthetic.example` only when there is none; it never edits one
 * that exists.
 */
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

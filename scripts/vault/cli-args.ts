import { parseDatabaseConnection } from "../../infrastructure/storage-hardening";

/**
 * Pure helpers of `bun run vault:migrate` and `bun run vault:rotate` (#141):
 * their arguments, the backup's file name and the Postgres environment that
 * `pg_dump` gets. Tested without a terminal or a database.
 */

export type VaultCliArgs = Readonly<{
  /** The person whose rows are sealed; LOCAL_USER_ID when not given. */
  actor: string | null;
  /** An existing backup to rely on instead of making a new one (migrate only). */
  backup: string | null;
  /** The person confirmed on the command line that the backup is kept safe. */
  backupConfirmed: boolean;
  batchSize: number;
}>;

const DEFAULT_BATCH = 500;

export type ParsedArgs =
  Readonly<{ ok: true; args: VaultCliArgs }> | Readonly<{ ok: false; error: string }>;

export const parseVaultArgs = (argv: readonly string[]): ParsedArgs => {
  let actor: string | null = null;
  let backup: string | null = null;
  let backupConfirmed = false;
  let batchSize = DEFAULT_BATCH;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--actor":
      case "--backup":
      case "--batch":
        if (value === undefined || value.startsWith("--")) {
          return { ok: false, error: `${flag} needs a value` };
        }
        index += 1;
        if (flag === "--actor") actor = value;
        if (flag === "--backup") backup = value;
        if (flag === "--batch") {
          const size = Number(value);
          if (!Number.isInteger(size) || size < 1 || size > 5000) {
            return { ok: false, error: "--batch is a whole number from 1 to 5000" };
          }
          batchSize = size;
        }
        break;
      case "--backup-confirmed":
        backupConfirmed = true;
        break;
      default:
        return { ok: false, error: `unknown argument: ${flag ?? ""}` };
    }
  }
  return { ok: true, args: { actor, backup, backupConfirmed, batchSize } };
};

/** `pre-encryption-2026-10-31T120000Z.dump`: sortable, no colons. */
export const backupFileName = (now: Date): string =>
  `pre-encryption-${now
    .toISOString()
    .replace(/[:.]/g, "")
    .replace(/\d{3}Z$/, "Z")}.dump`;

/**
 * The libpq environment for `pg_dump`, so the password never appears on a
 * command line (where other users of the machine could read it). Null when
 * the URL cannot be read.
 */
export const pgEnvFor = (url: string): Readonly<Record<string, string>> | null => {
  const connection = parseDatabaseConnection(url);
  if (connection.kind === "invalid") return null;
  const text = url.trim();
  const parsed = URL.canParse(text)
    ? new URL(text)
    : new URL(text.replace("@/", "@dummy-host.invalid/"));
  const password =
    parsed.searchParams.get("password") ?? decodeURIComponent(parsed.password);
  return {
    PGHOST: connection.kind === "socket" ? connection.socketDir : connection.host,
    PGPORT: String(connection.port),
    ...(connection.user === null ? {} : { PGUSER: connection.user }),
    ...(password === "" ? {} : { PGPASSWORD: password }),
    ...(connection.database === null ? {} : { PGDATABASE: connection.database }),
  };
};

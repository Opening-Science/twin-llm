/**
 * `bun run setup:local -- --owner-cluster` (#144): a Postgres cluster that
 * only the owner's OS user can reach, in the state directory, with no TCP
 * listener. It never touches another cluster: it works only inside
 * `$TWINLLM_STATE_DIR/pg`, and stops if that folder holds something else.
 *
 *   $TWINLLM_STATE_DIR/pg                 the cluster (initdb sets 0700)
 *   $TWINLLM_STATE_DIR/pg-socket          the socket folder (0700, socket 0700)
 *   $TWINLLM_STATE_DIR/owner-cluster.env  the passwords and DATABASE_URL (0600)
 *
 * The bootstrap superuser (`twinllm_admin`) is only for setup. The app
 * connects as `twinllm`, which owns the `twin_llm` database and is not a
 * superuser. Both passwords are 32 random bytes and are never printed.
 * Re-running is safe: it starts the cluster if it is stopped and adds what is
 * missing.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import {
  appendFile,
  chmod,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  APP_ROLE,
  shellWord,
  shownPath,
  STORAGE_CHECK_COMMAND,
} from "../../infrastructure/storage-hardening";
import { currentPlatform, effectiveEnv, openSqlWith } from "./detect";
import { parseEnvFile } from "./env-file";
import { type Outcome } from "./plan";
import { pgvectorInstall } from "./prerequisites";
import { storageSettings } from "./storage-probe";

export const OWNER_CLUSTER_FLAG = "--owner-cluster";

/** Who sets the cluster up; the app never connects as this role. */
export const ADMIN_ROLE = "twinllm_admin";

/** The database the app uses in personal mode. */
export const OWNER_DATABASE = "twin_llm";

/** The port names the socket file only; there is no TCP listener. */
export const OWNER_PORT = 5432;

/** Unix socket paths longer than this fail on macOS (104 bytes with the final NUL). */
export const MAX_SOCKET_PATH = 103;

const CONF_MARKER = "# TwinLLM owner-only cluster (#144)";

/**
 * True for `--owner-cluster` alone (after an optional `--`), false when it is
 * absent, null when it is combined with other flags.
 */
export const ownerClusterRequested = (argv: readonly string[]): boolean | null => {
  const flags = argv.filter((arg) => arg !== "--");
  if (!flags.includes(OWNER_CLUSTER_FLAG)) return false;
  return flags.length === 1 ? true : null;
};

export type OwnerClusterPaths = Readonly<{
  dataDir: string;
  socketDir: string;
  secrets: string;
  log: string;
}>;

export const ownerClusterPaths = (stateDir: string): OwnerClusterPaths => {
  const base = stateDir.replace(/\/+$/, "");
  return {
    dataDir: `${base}/pg`,
    socketDir: `${base}/pg-socket`,
    secrets: `${base}/owner-cluster.env`,
    log: `${base}/pg/server.log`,
  };
};

/** A plain sentence when the socket path is too long for the OS, else null. */
export const socketPathProblem = (
  socketDir: string,
  port = OWNER_PORT,
): string | null => {
  const length = Buffer.byteLength(`${socketDir}/.s.PGSQL.${port}`);
  return length > MAX_SOCKET_PATH
    ? `the socket path would be ${length} bytes, over the ${MAX_SOCKET_PATH} the OS allows; set TWINLLM_STATE_DIR to a shorter folder`
    : null;
};

const confString = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** The lines appended to the cluster's postgresql.conf. */
export const ownerClusterConf = (socketDir: string): string =>
  [
    "",
    CONF_MARKER,
    "listen_addresses = ''",
    `unix_socket_directories = ${confString(socketDir)}`,
    "unix_socket_permissions = 0700",
    "log_statement = 'none'",
    "log_min_duration_statement = -1",
    "",
  ].join("\n");

export const hasOwnerClusterConf = (conf: string): boolean => conf.includes(CONF_MARKER);

/** 32 random bytes as base64url: no quote, slash or `@` to escape anywhere. */
export const passwordFromBytes = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64url");

/**
 * The app's DATABASE_URL: the socket folder as `host`, with `localhost` in
 * the authority because Prisma's migrate refuses an empty host.
 */
export const ownerDatabaseUrl = (
  input: Readonly<{ password: string; socketDir: string }>,
): string =>
  `postgresql://${APP_ROLE}:${encodeURIComponent(input.password)}@localhost/${OWNER_DATABASE}?host=${encodeURIComponent(input.socketDir)}`;

export type OwnerSecrets = Readonly<{ adminPassword: string; databaseUrl: string }>;

export const secretsFileText = (secrets: OwnerSecrets): string =>
  [
    "# Written by bun run setup:local -- --owner-cluster (#144). Owner-only; do not share.",
    `TWINLLM_PG_ADMIN_PASSWORD=${secrets.adminPassword}`,
    `DATABASE_URL=${secrets.databaseUrl}`,
    "",
  ].join("\n");

export const parseSecretsFile = (text: string): OwnerSecrets | null => {
  const values = parseEnvFile(text);
  const adminPassword = values.TWINLLM_PG_ADMIN_PASSWORD;
  const databaseUrl = values.DATABASE_URL;
  return adminPassword && databaseUrl ? { adminPassword, databaseUrl } : null;
};

/** The password inside an owner URL, for creating the role; never printed. */
export const urlPassword = (url: string): string | null => {
  if (!URL.canParse(url)) return null;
  const password = decodeURIComponent(new URL(url).password);
  return password === "" ? null : password;
};

/**
 * Replaces the DATABASE_URL line of .env.local with the owner cluster's,
 * without printing it; the new file is 0600 from the start.
 */
export const envSwapCommand = (secretsShown: string): string =>
  `(umask 077 && { grep -v '^DATABASE_URL=' .env.local 2>/dev/null; grep '^DATABASE_URL=' ${shellWord(secretsShown)}; } > .env.local.new && mv .env.local.new .env.local)`;

/**
 * Where initdb is: TWINLLM_PG_BIN, else `pg_config --bindir`, else the folder
 * of `initdb` on PATH. Null when none has an initdb.
 */
export const choosePgBin = (
  candidates: Readonly<{
    fromEnv: string | undefined;
    fromPgConfig: string | null;
    fromPath: string | null;
  }>,
  hasInitdb: (dir: string) => boolean,
): string | null =>
  [candidates.fromEnv?.trim() || null, candidates.fromPgConfig, candidates.fromPath].find(
    (dir): dir is string => dir !== null && hasInitdb(dir),
  ) ?? null;

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

class Blocked extends Error {}

const run = (
  argv: readonly string[],
  options: Readonly<{ env?: NodeJS.ProcessEnv; quiet?: boolean }> = {},
): { ok: boolean; stdout: string } => {
  const [command, ...args] = argv;
  if (!options.quiet) process.stdout.write(`\n$ ${argv.join(" ")}\n`);
  const result = spawnSync(command ?? "false", args, {
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
  });
  if (!options.quiet && result.stdout) process.stdout.write(result.stdout);
  return { ok: result.status === 0, stdout: result.stdout ?? "" };
};

const findPgBin = (env: Readonly<Record<string, string | undefined>>): string | null => {
  const pgConfig = run(["pg_config", "--bindir"], { quiet: true });
  const which = run(["sh", "-c", "command -v initdb"], { quiet: true });
  return choosePgBin(
    {
      fromEnv: env.TWINLLM_PG_BIN,
      fromPgConfig: pgConfig.ok ? pgConfig.stdout.trim() || null : null,
      fromPath:
        which.ok && which.stdout.trim() !== "" ? dirname(which.stdout.trim()) : null,
    },
    (dir) => existsSync(join(dir, "initdb")),
  );
};

const readSecrets = async (path: string): Promise<OwnerSecrets | null> =>
  parseSecretsFile(await readFile(path, "utf8").catch(() => ""));

/** initdb into an empty folder, with the admin password from an owner-only file. */
const initCluster = async (
  bin: string,
  paths: OwnerClusterPaths,
  adminPassword: string,
): Promise<void> => {
  const pwfile = `${paths.secrets}.initdb`;
  await writeFile(pwfile, `${adminPassword}\n`, { mode: 0o600 });
  try {
    const made = run([
      join(bin, "initdb"),
      "-D",
      paths.dataDir,
      "-U",
      ADMIN_ROLE,
      `--pwfile=${pwfile}`,
      "--auth-local=scram-sha-256",
      "--auth-host=reject",
      "-E",
      "UTF8",
      "--no-locale",
    ]);
    if (!made.ok) throw new Blocked("initdb failed; see its output above");
  } finally {
    await rm(pwfile, { force: true });
  }
  await appendFile(
    join(paths.dataDir, "postgresql.conf"),
    ownerClusterConf(paths.socketDir),
  );
};

const isRunning = (bin: string, dataDir: string): boolean =>
  run([join(bin, "pg_ctl"), "-D", dataDir, "status"], { quiet: true }).ok;

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const quoteLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** Role, database, pgvector; each only when missing. */
const prepareDatabase = async (
  paths: OwnerClusterPaths,
  secrets: OwnerSecrets,
  platform: ReturnType<typeof currentPlatform>,
): Promise<string> => {
  const appPassword = urlPassword(secrets.databaseUrl);
  if (appPassword === null) throw new Blocked("owner-cluster.env has no app password");
  const admin = (database: string) =>
    openSqlWith({
      path: `${paths.socketDir}/.s.PGSQL.${OWNER_PORT}`,
      username: ADMIN_ROLE,
      password: secrets.adminPassword,
      database,
    });
  const done: string[] = [];
  const postgres = admin("postgres");
  try {
    const [vector] = await postgres.unsafe(
      "select exists(select 1 from pg_available_extensions where name = 'vector') as ok, current_setting('server_version_num')::int / 10000 as major",
    );
    if (vector?.ok !== true) {
      throw new Blocked(
        `pgvector is not installed for this Postgres: ${pgvectorInstall(platform, Number(vector?.major) || null)}`,
      );
    }
    const [role] = await postgres.unsafe("select 1 from pg_roles where rolname = $1", [
      APP_ROLE,
    ]);
    if (role === undefined) {
      await postgres.unsafe(
        `create role ${quoteIdent(APP_ROLE)} login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password ${quoteLiteral(appPassword)}`,
      );
      done.push(`role ${APP_ROLE} (not a superuser)`);
    }
    const [db] = await postgres.unsafe("select 1 from pg_database where datname = $1", [
      OWNER_DATABASE,
    ]);
    if (db === undefined) {
      await postgres.unsafe(
        `create database ${quoteIdent(OWNER_DATABASE)} owner ${quoteIdent(APP_ROLE)}`,
      );
      await postgres.unsafe(
        `revoke all on database ${quoteIdent(OWNER_DATABASE)} from public`,
      );
      done.push(`database ${OWNER_DATABASE} owned by ${APP_ROLE}`);
    }
  } finally {
    await postgres.close();
  }
  // pgvector is not a trusted extension, so the admin adds it; the migration's
  // CREATE EXTENSION IF NOT EXISTS then finds it.
  const appDb = admin(OWNER_DATABASE);
  try {
    await appDb.unsafe("create extension if not exists vector");
  } finally {
    await appDb.close();
  }
  return done.length === 0
    ? "role and database already there"
    : `created ${done.join(", ")}`;
};

const MARK: Readonly<Record<Outcome["result"], string>> = {
  done: "[ready]  ",
  skipped: "[skipped]",
  off: "[off]    ",
  stale: "[stale]  ",
  blocked: "[blocked]",
  failed: "[FAILED] ",
};

/** The checklist; on a problem, how to go on (finished steps are skipped). */
export const formatOwnerChecklist = (outcomes: readonly Outcome[]): string =>
  [
    "",
    "Owner-only Postgres",
    ...outcomes.map(
      (outcome) => `${MARK[outcome.result]} ${outcome.title}: ${outcome.detail}`,
    ),
    ...(outcomes.every((outcome) => outcome.result === "done")
      ? []
      : [
          "",
          `Fix the item above and run bun run setup:local -- ${OWNER_CLUSTER_FLAG} again.`,
        ]),
    "",
  ].join("\n");

type Step = Readonly<{ title: string; work: () => Promise<string> }>;

const runSteps = async (steps: readonly Step[]): Promise<readonly Outcome[]> => {
  const outcomes: Outcome[] = [];
  for (const step of steps) {
    if (outcomes.some((outcome) => outcome.result !== "done")) {
      outcomes.push({
        id: "database",
        title: step.title,
        result: "blocked",
        detail: "waits for the step above",
      });
      continue;
    }
    process.stdout.write(`\n== ${step.title}\n`);
    try {
      outcomes.push({
        id: "database",
        title: step.title,
        result: "done",
        detail: await step.work(),
      });
    } catch (error) {
      const detail =
        error instanceof Blocked
          ? error.message
          : "stopped with an error; see the output above";
      if (!(error instanceof Blocked))
        console.error(error instanceof Error ? error.name : error);
      outcomes.push({ id: "database", title: step.title, result: "failed", detail });
    }
  }
  return outcomes;
};

/** The whole `--owner-cluster` run; returns the exit code. */
export const runOwnerCluster = async (root: string): Promise<number> => {
  process.umask(0o077);
  const platform = currentPlatform();
  const { env } = await effectiveEnv(root, platform);
  const home = homedir();
  const settings = storageSettings(root, env, { platform, home });
  const paths = ownerClusterPaths(settings.stateDir);
  const show = (path: string) => shownPath(path, { cwd: root, home });
  const state = { bin: "", secrets: null as OwnerSecrets | null };

  process.stdout.write(
    `TwinLLM owner-only Postgres (${platform}) in ${show(settings.stateDir)}\n`,
  );

  const outcomes = await runSteps([
    {
      title: "Postgres programs",
      work: async () => {
        const bin = findPgBin(env);
        if (bin === null) {
          throw new Blocked(
            "initdb not found. Install Postgres with pgvector (see bun run doctor), or set TWINLLM_PG_BIN to the folder that holds initdb and pg_ctl",
          );
        }
        state.bin = bin;
        return `initdb and pg_ctl in ${show(bin)}`;
      },
    },
    {
      title: "State folder",
      work: async () => {
        const problem = socketPathProblem(paths.socketDir);
        if (problem !== null) throw new Blocked(problem);
        await mkdir(settings.stateDir, { recursive: true, mode: 0o700 });
        await chmod(settings.stateDir, 0o700);
        await mkdir(paths.socketDir, { recursive: true, mode: 0o700 });
        await chmod(paths.socketDir, 0o700);
        return `${show(settings.stateDir)} and its socket folder, mode 700`;
      },
    },
    {
      title: "Cluster",
      work: async () => {
        if (existsSync(join(paths.dataDir, "PG_VERSION"))) {
          state.secrets = await readSecrets(paths.secrets);
          if (state.secrets === null) {
            throw new Blocked(
              `a cluster is in ${show(paths.dataDir)} but ${show(paths.secrets)} is missing or incomplete; restore it from a backup, or move the cluster away and run this again`,
            );
          }
          const conf = await readFile(join(paths.dataDir, "postgresql.conf"), "utf8");
          if (!hasOwnerClusterConf(conf)) {
            throw new Blocked(
              `${show(paths.dataDir)} holds a cluster this command did not make; it is left alone. Move it away or set TWINLLM_STATE_DIR to another folder`,
            );
          }
          return "already there";
        }
        const entries = await readdir(paths.dataDir).catch(() => []);
        if (entries.length > 0) {
          throw new Blocked(
            `${show(paths.dataDir)} is not empty and is not a cluster; it is left alone`,
          );
        }
        const secrets: OwnerSecrets = {
          adminPassword: passwordFromBytes(randomBytes(32)),
          databaseUrl: ownerDatabaseUrl({
            password: passwordFromBytes(randomBytes(32)),
            socketDir: paths.socketDir,
          }),
        };
        // Written first, so a stopped run never leaves a cluster nobody can open.
        await writeFile(paths.secrets, secretsFileText(secrets), {
          mode: 0o600,
          flag: "wx",
        });
        await initCluster(state.bin, paths, secrets.adminPassword);
        state.secrets = secrets;
        return `created: no TCP listener, socket in ${show(paths.socketDir)}, scram-sha-256; passwords in ${show(paths.secrets)} (mode 600)`;
      },
    },
    {
      title: "Start the cluster",
      work: async () => {
        if (isRunning(state.bin, paths.dataDir)) return "already running";
        const started = run([
          join(state.bin, "pg_ctl"),
          "-D",
          paths.dataDir,
          "-l",
          paths.log,
          "-w",
          "start",
        ]);
        if (!started.ok) {
          throw new Blocked(`pg_ctl could not start it; see ${show(paths.log)}`);
        }
        return "started";
      },
    },
    {
      title: "Role and database",
      work: () => prepareDatabase(paths, state.secrets as OwnerSecrets, platform),
    },
    {
      title: "Migrations",
      work: async () => {
        const migrated = run(["bunx", "prisma", "migrate", "deploy"], {
          env: {
            ...process.env,
            DATABASE_URL: (state.secrets as OwnerSecrets).databaseUrl,
          },
        });
        if (!migrated.ok)
          throw new Blocked("prisma migrate deploy failed; see its output above");
        return "applied";
      },
    },
  ]);

  process.stdout.write(formatOwnerChecklist(outcomes));
  if (outcomes.some((outcome) => outcome.result !== "done")) return 1;
  const pgCtl = shellWord(show(join(state.bin, "pg_ctl")));
  process.stdout.write(
    [
      "",
      "Next:",
      "1. Point .env.local at the cluster (copies the line without printing it):",
      `   ${envSwapCommand(show(paths.secrets))}`,
      "2. Set DATA_MODE=personal in .env.local if it is not, then start the app.",
      `3. ${STORAGE_CHECK_COMMAND} repeats the checks the app makes at startup.`,
      `After a reboot, start the cluster again with this command or with ${pgCtl} -D ${shellWord(show(paths.dataDir))} -l ${shellWord(show(paths.log))} start`,
      'Moving data from another Postgres: docs/runbook.md, "Owner-only Postgres" (back it up first).',
      "",
    ].join("\n"),
  );
  return 0;
};

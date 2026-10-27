/**
 * Looks at this machine for `setup:local` and `doctor`: which programs are on
 * PATH, whether Postgres answers at DATABASE_URL, what is already installed.
 * Read-only; the only thing it opens is a database connection.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readdir, readFile, statfs } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";

import { DEMO_BODIES, DEMO_BODY_IDS } from "../../packages/anatomy/demo-bodies";
import { ATLAS_IDS, ATLASES } from "../../packages/anatomy/manifest";
import { resolveAnatomyDir } from "../../packages/anatomy/paths";
import { RIGGED_BODIES } from "../../packages/anatomy/rigged-bodies";
import { BUNDLE_SET_SQL } from "./cohort-fingerprint";
import { EVAL_COHORT } from "./cohort-pins";
import {
  defaultDatabaseUrl,
  databaseTarget,
  EXAMPLE_DATABASE_URL,
  envFileFromExample,
  parseEnvFile,
} from "./env-file";
import {
  type BundleSet,
  type ClinicalCounts,
  type CohortRows,
  type DatabaseProbe,
  type DetectedState,
  EXAMPLE_TITLE,
  type OllamaProbe,
} from "./plan";
import { type Platform, TOOL_IDS, type ToolId, type ToolProbe } from "./prerequisites";

type SqlRow = Readonly<Record<string, unknown>>;

/** LOCAL_USER_ID when .env.local does not set it, as in infrastructure/env.ts. */
export const DEFAULT_LOCAL_USER_ID = "local";
export type SqlQuery = Readonly<{
  unsafe: (query: string, params?: readonly unknown[]) => Promise<readonly SqlRow[]>;
}>;
export type SqlClient = SqlQuery &
  Readonly<{
    /** Runs `work` in one transaction: committed when it resolves, rolled back when it throws. */
    begin: <T>(work: (tx: SqlQuery) => Promise<T>) => Promise<T>;
    close: () => Promise<void>;
  }>;
type SqlConstructor = new (
  url: string,
  options?: Readonly<{ max?: number; connectionTimeout?: number }>,
) => SqlClient;

/** Bun's built-in Postgres client, so setup needs no installed packages. */
export const openSql = (url: string): SqlClient => {
  const ctor = (globalThis as { Bun?: { SQL?: SqlConstructor } }).Bun?.SQL;
  if (!ctor) throw new Error("setup scripts run under bun (bun run setup:local)");
  return new ctor(url, { max: 1, connectionTimeout: 5 });
};

const VERSION_ARGS: Readonly<Record<ToolId, readonly string[]>> = {
  bun: ["--version"],
  node: ["--version"],
  git: ["--version"],
  python3: ["--version"],
  java: ["-version"],
  shasum: ["--version"],
  curl: ["--version"],
  uv: ["--version"],
  zstd: ["--version"],
  ollama: ["--version"],
};

const probeTool = (id: ToolId): ToolProbe => {
  const run = spawnSync(id, VERSION_ARGS[id], { encoding: "utf8", timeout: 15_000 });
  if (run.error || run.status !== 0) return { output: null };
  return { output: `${run.stdout ?? ""}${run.stderr ?? ""}`.trim() };
};

export const currentPlatform = (): Platform =>
  process.platform === "darwin" ? "darwin" : "linux";

const readText = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
};

/**
 * The environment the app and its scripts will see: `.env.local` (or the file
 * setup is about to create), with the shell's values on top.
 */
export const effectiveEnv = async (
  root: string,
  platform: Platform,
): Promise<
  Readonly<{ envFile: boolean; env: Readonly<Record<string, string | undefined>> }>
> => {
  const existing = await readText(join(root, ".env.local"));
  const text =
    existing ??
    envFileFromExample(
      (await readText(join(root, ".env.synthetic.example"))) ?? "",
      defaultDatabaseUrl(platform, process.env.DATABASE_URL, userInfo().username),
    );
  return { envFile: existing !== null, env: { ...parseEnvFile(text), ...process.env } };
};

const errorCode = (error: unknown): string => {
  if (typeof error !== "object" || error === null) return "unknown error";
  const errno = Reflect.get(error, "errno");
  const code = Reflect.get(error, "code");
  return typeof errno === "string"
    ? errno
    : typeof code === "string"
      ? code
      : "unknown error";
};

const serverFacts = async (
  sql: SqlClient,
): Promise<Readonly<{ pgvector: boolean; serverMajor: number | null }>> => {
  const [row] = await sql.unsafe(
    "select current_setting('server_version_num')::int / 10000 as major, exists(select 1 from pg_available_extensions where name = 'vector') as vector",
  );
  const major = Number(row?.major);
  return {
    pgvector: row?.vector === true,
    serverMajor: Number.isFinite(major) ? major : null,
  };
};

const tableExists = async (sql: SqlQuery, table: string): Promise<boolean> => {
  const [row] = await sql.unsafe("select to_regclass($1) is not null as present", [
    `public.${table}`,
  ]);
  return row?.present === true;
};

/** Every cohort id in `subjects`, with its synthetic and total subjects and whether it has observations. */
const readWarehouse = async (sql: SqlQuery): Promise<readonly CohortRows[]> => {
  if (!(await tableExists(sql, "subjects"))) return [];
  const observations = await tableExists(sql, "observations");
  const rows = await sql.unsafe(
    "select cohort_id, count(*) filter (where is_synthetic)::int as synthetic, count(*)::int as total from subjects group by cohort_id order by cohort_id",
  );
  return Promise.all(
    rows.map(async (row) => {
      const cohortId = String(row.cohort_id);
      const [found] = observations
        ? await sql.unsafe(
            "select exists(select 1 from observations o join subjects s on s.subject_ref = o.subject_ref where s.cohort_id = $1) as present",
            [cohortId],
          )
        : [];
      return {
        cohortId,
        synthetic: Number(row.synthetic),
        total: Number(row.total),
        hasObservations: found?.present === true,
      };
    }),
  );
};

/** The fingerprint of the bundles ingested as `cohortId`, or null when there are none. */
export const readBundleSet = async (
  sql: SqlQuery,
  cohortId: string,
): Promise<BundleSet | null> => {
  if (!(await tableExists(sql, "bundles"))) return null;
  const [row] = await sql.unsafe(BUNDLE_SET_SQL, [cohortId]);
  const count = Number(row?.n ?? 0);
  return count > 0 ? { count, sha256: String(row?.digest) } : null;
};

/** Condition and MedicationRequest rows of `cohortId`; 0 for a table that does not exist yet. */
export const readClinicalCounts = async (
  sql: SqlQuery,
  cohortId: string,
): Promise<ClinicalCounts> => {
  const count = async (table: "conditions" | "medication_requests"): Promise<number> => {
    if (!(await tableExists(sql, table))) return 0;
    const [row] = await sql.unsafe(
      `select count(*)::int as n from ${table} t join subjects s on s.subject_ref = t.subject_ref where s.cohort_id = $1`,
      [cohortId],
    );
    return Number(row?.n ?? 0);
  };
  return {
    conditions: await count("conditions"),
    medicationRequests: await count("medication_requests"),
  };
};

/** Whether `clerkId` has the example thread; false while the tables are missing. */
export const readExampleThread = async (
  sql: SqlQuery,
  clerkId: string,
): Promise<boolean> => {
  if (!(await tableExists(sql, "threads")) || !(await tableExists(sql, "users")))
    return false;
  const [row] = await sql.unsafe(
    'select exists(select 1 from threads t join users u on u.id = t."userId" where u."clerkId" = $1 and t.title = $2) as present',
    [clerkId, EXAMPLE_TITLE],
  );
  return row?.present === true;
};

export const probeDatabase = async (
  url: string | undefined,
  localUserId = DEFAULT_LOCAL_USER_ID,
): Promise<DatabaseProbe> => {
  if (!url) return { kind: "no-url" };
  if (url === EXAMPLE_DATABASE_URL) return { kind: "placeholder" };
  const target = databaseTarget(url);
  let sql: SqlClient | null = null;
  try {
    sql = openSql(url);
    const facts = await serverFacts(sql);
    const appliedMigrations = (await tableExists(sql, "_prisma_migrations"))
      ? (
          await sql.unsafe(
            "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by migration_name",
          )
        ).map((row) => String(row.migration_name))
      : [];
    const warehouse = await readWarehouse(sql);
    const evalLoaded = warehouse.some((rows) => rows.cohortId === EVAL_COHORT.cohortId);
    const evalBundles = evalLoaded
      ? await readBundleSet(sql, EVAL_COHORT.cohortId)
      : null;
    const evalClinical = evalLoaded
      ? await readClinicalCounts(sql, EVAL_COHORT.cohortId)
      : null;
    const exampleThread = await readExampleThread(sql, localUserId);
    return {
      kind: "ok",
      ...facts,
      appliedMigrations,
      warehouse,
      evalBundles,
      evalClinical,
      exampleThread,
    };
  } catch (error) {
    const code = errorCode(error);
    if (code === "3D000" && target !== null) {
      try {
        const maintenance = openSql(target.maintenanceUrl);
        try {
          return {
            kind: "missing-database",
            name: target.name,
            ...(await serverFacts(maintenance)),
          };
        } finally {
          await maintenance.close();
        }
      } catch (inner) {
        return { kind: "unreachable", detail: errorCode(inner) };
      }
    }
    if (code === "28P01" || code === "28000") return { kind: "auth-failed" };
    return { kind: "unreachable", detail: code };
  } finally {
    await sql?.close().catch(() => undefined);
  }
};

const probeOllama = async (
  env: Readonly<Record<string, string | undefined>>,
): Promise<OllamaProbe> => {
  const provider = env.LLM_PROVIDER || "ollama";
  if (provider !== "ollama") return { kind: "not-used", provider };
  const baseUrl = (env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1").replace(
    /\/v1\/?$/,
    "",
  );
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return { kind: "unreachable", baseUrl };
    const body: unknown = await response.json();
    const models = Reflect.get(Object(body), "models");
    const names = Array.isArray(models)
      ? models
          .map((model: unknown) => Reflect.get(Object(model), "name"))
          .filter((name): name is string => typeof name === "string")
      : [];
    return { kind: "ok", baseUrl, models: names };
  } catch {
    return { kind: "unreachable", baseUrl };
  }
};

/** SHA-256 of a file, streamed; null when it does not exist. */
export const fileSha256 = (path: string): Promise<string | null> =>
  new Promise((resolve) => {
    if (!existsSync(path)) {
      resolve(null);
      return;
    }
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", () => resolve(null))
      .on("end", () => resolve(hash.digest("hex")));
  });

const missingPinned = async (
  dir: string,
  pins: readonly Readonly<{ fileName: string; sha256: string }>[],
): Promise<readonly string[]> => {
  const checks = await Promise.all(
    pins.map(async (pin) =>
      (await fileSha256(join(dir, pin.fileName))) === pin.sha256 ? null : pin.fileName,
    ),
  );
  return checks.filter((name) => name !== null);
};

const pinnedOpenTwinSha = async (root: string): Promise<string> => {
  const script = (await readText(join(root, "scripts", "sync-open-twin.sh"))) ?? "";
  return /OPEN_TWIN_SHA:-([0-9a-f]{40})/.exec(script)?.[1] ?? "unknown";
};

const freeDisk = async (root: string): Promise<number | null> => {
  try {
    const stats = await statfs(root);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
};

/** Conversation sets in `training-data/out/`, by their manifest; [] when the folder is missing. */
const trainingSetNames = async (root: string): Promise<readonly string[]> =>
  (await readdir(join(root, "training-data", "out")).catch(() => []))
    .filter((name) => name.endsWith(".manifest.json"))
    .map((name) => name.slice(0, -".manifest.json".length))
    .sort();

/** Everything setup and doctor decide from. */
export const detectState = async (root: string): Promise<DetectedState> => {
  const platform = currentPlatform();
  const { envFile, env } = await effectiveEnv(root, platform);
  const anatomyDir = resolveAnatomyDir(env.ANATOMY_DATA_DIR, root);
  const localUserId = env.LOCAL_USER_ID || DEFAULT_LOCAL_USER_ID;
  const migrations = (
    await readdir(join(root, "prisma", "migrations"), { withFileTypes: true }).catch(
      () => [],
    )
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const [
    database,
    ollama,
    anatomyMissing,
    riggedMissing,
    pinned,
    synced,
    freeDiskBytes,
    trainingSets,
  ] = await Promise.all([
    probeDatabase(env.DATABASE_URL, localUserId),
    probeOllama(env),
    missingPinned(anatomyDir, [
      ...ATLAS_IDS.map((id) => ATLASES[id]),
      ...DEMO_BODY_IDS.map((id) => DEMO_BODIES[id]),
    ]),
    missingPinned(
      anatomyDir,
      DEMO_BODY_IDS.map((id) => RIGGED_BODIES[id]),
    ),
    pinnedOpenTwinSha(root),
    readText(join(root, ".open-twin", "OPEN_TWIN_SHA")),
    freeDisk(root),
    trainingSetNames(root),
  ]);
  return {
    platform,
    tools: Object.fromEntries(TOOL_IDS.map((id) => [id, probeTool(id)])) as Record<
      ToolId,
      ToolProbe
    >,
    envFile,
    dataMode: env.DATA_MODE ?? null,
    authOff: env.LOCAL_MVP === "true" || env.AUTH_DISABLED === "true",
    localUserId,
    database,
    migrations,
    openTwin: { pinned, synced: synced?.trim() ?? null },
    anatomyMissing,
    riggedMissing,
    trainingSets,
    ollama,
    freeDiskBytes,
  };
};

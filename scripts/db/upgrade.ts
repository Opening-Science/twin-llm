/**
 * bun run db:upgrade [--plan]
 *
 * Brings a database up to this release's schema, as `bun run db:deploy`
 * does, but safe for an install that already has saved chats from before
 * the chat tables move (0.1.0, say). There a plain deploy stops at the
 * switch migration, which refuses until the older rows are copied. This
 * deploys up to the migration before the switch, runs db:chat-backfill and
 * db:chat-parity, and then deploys the rest. On a new or already moved
 * database it is a plain deploy. A switch migration that failed on an
 * earlier plain deploy changed nothing (it is one transaction), so it is
 * marked rolled back after the parity check and applied again.
 *
 * `--plan` prints the steps and changes nothing. Take a backup and stop
 * the app first, as for any schema change. The database is DATABASE_URL,
 * as for the app. See docs/storage.md, "Upgrading from 0.1.0".
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { PrismaClient } from "@/generated/prisma/client";

import {
  describeStep,
  migrationsThrough,
  partialConfigSource,
  planUpgrade,
  type MovePhase,
  type UpgradeState,
  type UpgradeStep,
} from "./upgrade-plan";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS_DIR = join(ROOT, "prisma/migrations");
const SCHEMA_PATH = join(ROOT, "prisma/schema.prisma");

export const migrationFolders = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(dir, entry.name, "migration.sql")),
    )
    .map((entry) => entry.name)
    .sort();

const tableExists = async (db: PrismaClient, table: string): Promise<boolean> => {
  const [row] = await db.$queryRawUnsafe<{ found: boolean }[]>(
    "SELECT to_regclass($1) IS NOT NULL AS found",
    `public.${table}`,
  );
  return row?.found === true;
};

const hasRows = async (db: PrismaClient, table: string): Promise<boolean> =>
  (await tableExists(db, table)) &&
  (
    await db.$queryRawUnsafe<{ found: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM "${table}") AS found`,
    )
  )[0]?.found === true;

const isPhase = (value: unknown): value is MovePhase =>
  value === "expanded" || value === "backfilled" || value === "switched";

export const readUpgradeState = async (
  db: PrismaClient,
  migrations: readonly string[],
): Promise<UpgradeState> => {
  const recorded = (await tableExists(db, "_prisma_migrations"))
    ? await db.$queryRawUnsafe<
        { migration_name: string; finished: boolean; rolled_back: boolean }[]
      >(
        `SELECT migration_name, finished_at IS NOT NULL AS finished,
                rolled_back_at IS NOT NULL AS rolled_back
         FROM "_prisma_migrations"`,
      )
    : [];
  const phaseRows = (await tableExists(db, "schema_moves"))
    ? await db.$queryRawUnsafe<{ phase: string }[]>(
        `SELECT phase::text AS phase FROM "schema_moves" WHERE move = 'chat-tables'`,
      )
    : [];
  const phase = phaseRows[0]?.phase;
  return {
    migrations,
    applied: recorded
      .filter((r) => r.finished && !r.rolled_back)
      .map((r) => r.migration_name),
    failed: recorded
      .filter((r) => !r.finished && !r.rolled_back)
      .map((r) => r.migration_name),
    phase: isPhase(phase) ? phase : null,
    chatRows: (await hasRows(db, "threads")) || (await hasRows(db, "conversations")),
  };
};

const run = (argv: readonly string[]): boolean => {
  const [command, ...args] = argv;
  if (command === undefined) return false;
  return spawnSync(command, args, { cwd: ROOT, stdio: "inherit" }).status === 0;
};

/** prisma migrate deploy over a copy of the migrations folder that ends at `migration`. */
const deployThrough = (migration: string): boolean => {
  const dir = mkdtempSync(join(tmpdir(), "twinllm-upgrade-"));
  try {
    const migrations = join(dir, "migrations");
    for (const name of migrationsThrough(migrationFolders(MIGRATIONS_DIR), migration)) {
      cpSync(join(MIGRATIONS_DIR, name), join(migrations, name), { recursive: true });
    }
    cpSync(
      join(MIGRATIONS_DIR, "migration_lock.toml"),
      join(migrations, "migration_lock.toml"),
    );
    const config = join(dir, "prisma.config.ts");
    writeFileSync(config, partialConfigSource(SCHEMA_PATH, migrations));
    return run(["bunx", "prisma", "migrate", "deploy", "--config", config]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const runStep = (step: UpgradeStep): boolean => {
  switch (step.kind) {
    case "deploy-through":
      return deployThrough(step.migration);
    case "backfill":
      return run(["bun", "run", "db:chat-backfill"]);
    case "parity":
      return run(["bun", "run", "db:chat-parity"]);
    case "resolve-rolled-back":
      return run([
        "bunx",
        "prisma",
        "migrate",
        "resolve",
        "--rolled-back",
        step.migration,
      ]);
    case "deploy":
      return run(["bunx", "prisma", "migrate", "deploy"]);
  }
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const { database } = await import("../../infrastructure/database");
  const db = database();
  let state: UpgradeState;
  try {
    state = await readUpgradeState(db, migrationFolders(MIGRATIONS_DIR));
  } catch {
    console.error("db:upgrade FAIL: could not read the database's migration state");
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
  const upgrade = planUpgrade(state);
  if (!upgrade.ok) {
    console.error(`db:upgrade FAIL: ${upgrade.reason}`);
    process.exit(1);
  }
  console.log("db:upgrade plan:");
  upgrade.steps.forEach((step, index) =>
    console.log(`  ${index + 1}. ${describeStep(step)}`),
  );
  if (process.argv.includes("--plan")) process.exit(0);
  for (const [index, step] of upgrade.steps.entries()) {
    console.log(`\n== db:upgrade step ${index + 1}: ${describeStep(step)}`);
    if (!runStep(step)) {
      console.error(
        `db:upgrade FAIL at step ${index + 1} (${describeStep(step)}); fix the cause and run it again`,
      );
      process.exit(1);
    }
  }
  console.log("\ndb:upgrade done");
}

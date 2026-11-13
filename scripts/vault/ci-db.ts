/**
 * The database steps of `bun run vault:ci-migrate`, each run as its own
 * process so that no connection of ours is open while `vault:migrate` checks
 * that the app is stopped.
 *
 *   seed   Imports the made-up fixtures in tests/fixtures/personal-import/
 *          for LOCAL_USER_ID through the import store, with DATA_MODE=synthetic,
 *          so every personal column is written plain, as an install from
 *          before #141 holds it. Refuses unless the person has no rows yet.
 *   state  Prints, per personal table, its row count, its plain values left
 *          and an MD5 of every row as stored, as one JSON line. No value.
 *
 * Run with the server-only preload. Only for a throwaway database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureAppUser } from "../../infrastructure/current-user";
import { database } from "../../infrastructure/database";
import { serverEnv, storageEnv } from "../../infrastructure/env";
import {
  PERSONAL_TABLES,
  plaintextCountSql,
} from "../../infrastructure/personal-columns";
import { personalDataStore } from "../../infrastructure/personal-data-store";
import { parseImport } from "../../packages/personal-data/parse-import";
import { savePlan } from "../../packages/personal-data/save-plan";
import { fileSha256 } from "../../packages/personal-data/text-file";
import { type ImportKind } from "../../packages/personal-data/types";
import { type DatabaseState } from "./ci-migrate-checks";

const FIXTURES = fileURLToPath(
  new URL("../../tests/fixtures/personal-import", import.meta.url),
);

const SEEDS: readonly Readonly<{ kind: ImportKind; path: string }>[] = [
  { kind: "fhir", path: "fhir-bundle.json" },
  { kind: "lab-csv", path: "lab-results.csv" },
  { kind: "table", path: "research-table.tsv" },
  { kind: "apple-health", path: "apple-health-export.xml" },
  { kind: "wearable", path: "wearables/oura-data-export.json" },
  { kind: "wearable", path: "wearables/my_whoop_data/sleeps.csv" },
  {
    kind: "wearable",
    path: "wearables/Takeout/Fitbit/Global Export Data/weight-2026-09-01.json",
  },
];

const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;

const rows = async (sql: string): Promise<readonly Record<string, unknown>[]> => {
  const result = await database().$queryRawUnsafe(sql);
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
};

const seed = async (): Promise<void> => {
  if (storageEnv().dataMode !== "synthetic") {
    throw new Error("seed writes plain rows; run it with DATA_MODE=synthetic");
  }
  const { id: userId } = await ensureAppUser(serverEnv().LOCAL_USER_ID);
  const existing = await database().personalDataset.count({ where: { userId } });
  if (existing > 0)
    throw new Error("this person already has datasets; use a new database");
  const store = personalDataStore();
  for (const { kind, path } of SEEDS) {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, path)));
    const fileName = path.split("/").pop() ?? path;
    const parsed = parseImport(kind, bytes, fileName);
    if (!parsed.ok) throw new Error(`${path}: ${parsed.refusal.code}`);
    const plan = savePlan(parsed, {
      userId,
      name: "",
      fileName,
      sha256: fileSha256(bytes),
      byteSize: bytes.byteLength,
    });
    if (plan.dataset.rowCount === 0) throw new Error(`${path}: nothing to store`);
    const saved = await store.save(plan);
    if (!saved.ok) throw new Error(`${path}: not saved`);
    console.log(`  ${kind} ${fileName}: ${plan.dataset.rowCount} row(s)`);
  }
};

const state = async (): Promise<DatabaseState> => {
  const entries = await Promise.all(
    PERSONAL_TABLES.map(async (entry) => {
      const [plain] = await rows(plaintextCountSql(entry));
      const [digest] = await rows(
        `SELECT count(*)::int AS n, coalesce(md5(string_agg(md5(t::text), '' ORDER BY md5(t::text))), '') AS d FROM ${quote(entry.table)} t`,
      );
      const plainTotal = Object.values(plain ?? {}).reduce<number>(
        (total, value) => total + Number(value),
        0,
      );
      return [
        entry.table,
        {
          rows: Number(digest?.n ?? 0),
          plain: plainTotal,
          digest: String(digest?.d ?? ""),
        },
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
};

const main = async (): Promise<void> => {
  const command = process.argv[2];
  if (command === "seed") await seed();
  else if (command === "state") console.log(JSON.stringify(await state()));
  else throw new Error("use: ci-db.ts seed | state");
};

try {
  await main();
  await database().$disconnect();
  process.exit(0);
} catch (error) {
  console.error(`ci-db: ${error instanceof Error ? error.message : "failed"}`);
  await database().$disconnect();
  process.exit(1);
}

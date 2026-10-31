/**
 * `bun run vault:migrate` (#141, docs/runbook.md "Encryption at rest"): seals
 * an existing personal install's rows and mesh files in place, with the app
 * stopped.
 *
 *   1. Refuses unless DATA_MODE=personal and no other session uses the database.
 *   2. Backs up first: `pg_dump` to `$TWINLLM_STATE_DIR/backups/` (owner-only)
 *      and a copy of the person's mesh folder, and prints the dump's SHA-256;
 *      or takes `--backup <file>` made before. Refuses to go on until the
 *      person confirms the backup (typed, or `--backup-confirmed`).
 *   3. Unlocks the vault with the passphrase, or sets one up (with a recovery
 *      code) when there is none yet.
 *   4. Drops the plain search vectors (the app rebuilds them sealed), then
 *      seals every listed column in batches per transaction, each value
 *      checked by opening it again. Resumable and idempotent.
 *   5. Seals the mesh files, checks them, removes the plain copies.
 *   6. Checks that nothing of the person is left unsealed, and writes the
 *      `vault.migrate` audit row with counts.
 *
 * Synthetic installs are not touched. Prints table names and counts only.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { chmod, cp, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { storageEnv } from "../../infrastructure/env";
import { resealMeshFiles } from "../../infrastructure/mesh-files";
import { PERSONAL_TABLES, pendingRowsSql } from "../../infrastructure/personal-columns";
import { resealOwner } from "../../infrastructure/reseal";
import { backupFileName, parseVaultArgs, pgEnvFor } from "./cli-args";
import { openTerminal } from "./terminal";
import {
  actorOf,
  appendVaultCounts,
  cipherOf,
  meshDirOf,
  type Opened,
  otherSessions,
  ownerUserId,
  readRecord,
  resealPorts,
  setUpOnTerminal,
  sqlRun,
  unlockOnTerminal,
  zeroKeys,
} from "./vault-cli";

const terminal = openTerminal();

const stop = (message: string, code = 1): never => {
  terminal.say(message);
  terminal.close();
  process.exit(code);
};

const fileSha256 = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });

/** pg_dump from TWINLLM_PG_BIN, else `pg_config --bindir`, else PATH. */
const pgDumpPath = (): string => {
  const fromEnv = process.env.TWINLLM_PG_BIN?.trim();
  if (fromEnv && existsSync(join(fromEnv, "pg_dump"))) return join(fromEnv, "pg_dump");
  const config = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  const bin = config.status === 0 ? config.stdout.trim() : "";
  return bin !== "" && existsSync(join(bin, "pg_dump"))
    ? join(bin, "pg_dump")
    : "pg_dump";
};

const makeBackup = async (stateDir: string, userId: string): Promise<string> => {
  const dir = join(stateDir, "backups");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const path = join(dir, backupFileName(new Date()));
  const pgEnv = pgEnvFor(storageEnv().databaseUrl);
  if (pgEnv === null) return stop("DATABASE_URL could not be read; no backup was made.");
  terminal.say("Backing up the database (pg_dump)...");
  const dump = spawnSync(
    pgDumpPath(),
    ["--format=custom", "--no-owner", "--file", path],
    {
      env: { ...process.env, ...pgEnv },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  if (dump.status !== 0) return stop("pg_dump failed; nothing was changed.");
  await chmod(path, 0o600);
  const meshes = join(storageEnv().vitronicDir, userId);
  if (existsSync(meshes)) {
    await cp(meshes, `${path}.vitronic`, { recursive: true, preserveTimestamps: true });
    await chmod(`${path}.vitronic`, 0o700);
  }
  return path;
};

const main = async (): Promise<void> => {
  const parsed = parseVaultArgs(process.argv.slice(2));
  if (!parsed.ok) return stop(parsed.error);
  const { args } = parsed;
  const env = storageEnv();
  if (env.dataMode !== "personal") {
    return stop(
      "DATA_MODE is synthetic: synthetic rows stay plain. Nothing to migrate.",
      0,
    );
  }
  if ((await otherSessions()) > 0) {
    return stop(
      "Another session uses the database. Stop the app (bun run dev or start) and run this again.",
    );
  }
  const actorId = actorOf(args.actor);
  const userId = await ownerUserId(actorId);
  if (userId === null) return stop("This person has no rows yet. Nothing to migrate.", 0);

  // 2. Backup first.
  const backup = args.backup ?? (await makeBackup(env.stateDir, userId));
  const info = await stat(backup).catch(() => null);
  if (info === null || info.size === 0)
    return stop("The backup file is missing or empty.");
  terminal.say(`Backup: ${backup}`);
  terminal.say(`SHA-256: ${await fileSha256(backup)}`);
  if (existsSync(`${backup}.vitronic`)) terminal.say(`Mesh files: ${backup}.vitronic`);
  terminal.say(
    "The backup holds your data in plain text. Keep it somewhere safe (or delete it once you have checked the migration).",
  );
  if (!args.backupConfirmed) {
    const answer = await terminal.line('Type "backed up" to go on: ');
    if (answer.trim().toLowerCase() !== "backed up") {
      return stop("Not confirmed. Nothing was changed.");
    }
  }

  // 3. The vault.
  const read = await readRecord(actorId);
  if (read.kind === "unreadable")
    return stop("The key file cannot be read. Nothing was changed.");
  const opened: Opened | null =
    read.kind === "found"
      ? await unlockOnTerminal(terminal, actorId, read.record)
      : await setUpOnTerminal(terminal, actorId);
  if (opened === null) return stop("Nothing was changed.");
  const cipher = cipherOf(opened.keys);

  // 4. Rows. Plain search vectors are dropped; the app rebuilds them sealed.
  const query = sqlRun();
  await query(
    "DELETE FROM thread_search_embeddings WHERE user_id = $1 AND embedding IS NOT NULL",
    [userId],
  );
  const counts = await resealOwner(
    resealPorts((table, rows) => terminal.say(`  ${table}: ${rows} row(s) sealed`)),
    cipher,
    userId,
    args.batchSize,
  );

  // 5. Mesh files.
  const meshes = await resealMeshFiles(meshDirOf(userId), userId, cipher);

  // 6. Check: nothing of this person is left unsealed.
  for (const entry of PERSONAL_TABLES) {
    const left = await query(pendingRowsSql(entry, cipher.activeKeyId ?? ""), [
      userId,
      "",
      1,
    ]);
    if (left.length > 0)
      return stop(`${entry.table} still has rows to seal; run this again.`);
  }
  const total = { ...counts, meshFiles: meshes.sealed + meshes.resealed };
  await appendVaultCounts(actorId, "migrate", total);
  zeroKeys(opened.keys);
  terminal.say(
    `Done: ${Object.values(counts).reduce((a, b) => a + b, 0)} row(s) and ${total.meshFiles} mesh file(s) sealed.`,
  );
  terminal.say(
    `When you no longer need the plain backup, delete it: rm -r ${JSON.stringify(backup)} ${JSON.stringify(`${backup}.vitronic`)}`,
  );
  terminal.say(`(bun run doctor warns while a backup in ${dirname(backup)} exists.)`);
  terminal.close();
};

await main();
process.exit(0);

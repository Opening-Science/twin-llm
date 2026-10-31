/**
 * `bun run vault:rotate` (#141, docs/runbook.md "Encryption at rest"): a new
 * data key for one person, with the app stopped.
 *
 *   1. Refuses unless DATA_MODE=personal and no other session uses the database.
 *   2. Opens the vault with the passphrase.
 *   3. Unless a rotation is already under way: makes a new data key, keeps the
 *      old one as retiring, rewraps both under the passphrase and a new
 *      recovery code (shown once, confirmed saved), and writes the key file.
 *   4. Reseals every row and mesh file that names the retiring key, in
 *      batches per transaction; resumable: run it again after a stop.
 *   5. Once no row or file names the retiring key, removes it from the key
 *      file and writes the `vault.rotate` audit row with counts.
 *
 * A passphrase change alone needs no rotation (recovery rewraps the key).
 * Prints table names and counts only, and the new recovery code once.
 */
import { storageEnv } from "../../infrastructure/env";
import { meshFilesWithKey, resealMeshFiles } from "../../infrastructure/mesh-files";
import { resealOwner, rowsWithKey } from "../../infrastructure/reseal";
import {
  argon2Available,
  newDataKey,
  newKeyId,
  newRecoveryCode,
} from "../../infrastructure/vault-crypto";
import { sealRecord } from "../../features/vault/vault-service";
import { parseVaultArgs } from "./cli-args";
import { openTerminal } from "./terminal";
import {
  actorOf,
  appendVaultCounts,
  cipherOf,
  meshDirOf,
  otherSessions,
  ownerUserId,
  readRecord,
  resealPorts,
  sqlRun,
  unlockOnTerminal,
  writeRecord,
  zeroKeys,
} from "./vault-cli";

const terminal = openTerminal();

const stop = (message: string, code = 1): never => {
  terminal.say(message);
  terminal.close();
  process.exit(code);
};

const main = async (): Promise<void> => {
  const parsed = parseVaultArgs(process.argv.slice(2));
  if (!parsed.ok) return stop(parsed.error);
  const { args } = parsed;
  if (storageEnv().dataMode !== "personal") {
    return stop("DATA_MODE is synthetic: there is no key to rotate.", 0);
  }
  if ((await otherSessions()) > 0) {
    return stop(
      "Another session uses the database. Stop the app (bun run dev or start) and run this again.",
    );
  }
  const actorId = actorOf(args.actor);
  const read = await readRecord(actorId);
  if (read.kind !== "found") {
    return stop(
      read.kind === "missing"
        ? "No passphrase is set for this person; there is no key to rotate."
        : "The key file cannot be read. Nothing was changed.",
    );
  }
  let opened = await unlockOnTerminal(terminal, actorId, read.record);
  if (opened === null) return stop("Nothing was changed.");

  // 3. Start a rotation unless one is under way (a stopped run resumes here).
  if (opened.keys.retiring.length === 0) {
    const dek = newDataKey();
    const keyId = newKeyId();
    const recoveryCode = newRecoveryCode();
    const record = await sealRecord({
      actorId,
      keyId,
      dek,
      passphrase: opened.passphrase,
      recoveryCode,
      createdAt: read.record.createdAt,
      now: new Date(),
      argon2: argon2Available(),
      retiring: [opened.keys.active],
    });
    terminal.say(
      `New recovery code (shown once; the old one stops working): ${recoveryCode}`,
    );
    const saved = await terminal.line('Type "saved" once you have written it down: ');
    if (saved.trim().toLowerCase() !== "saved") {
      dek.fill(0);
      return stop("Not confirmed. Nothing was changed.");
    }
    await appendVaultCounts(actorId, "rotateStart");
    await writeRecord(actorId, record);
    opened = {
      record,
      passphrase: opened.passphrase,
      keys: { active: { keyId, dataKey: dek }, retiring: [opened.keys.active] },
    };
    terminal.say("New key in place; the old one is retiring.");
  } else {
    terminal.say("Resuming the rotation that was under way.");
  }

  // 4. Rows and mesh files that still name a retiring key.
  const userId = await ownerUserId(actorId);
  const cipher = cipherOf(opened.keys);
  const counts =
    userId === null
      ? {}
      : await resealOwner(
          resealPorts((table, rows) =>
            terminal.say(`  ${table}: ${rows} row(s) resealed`),
          ),
          cipher,
          userId,
          args.batchSize,
        );
  const meshes =
    userId === null
      ? { sealed: 0, resealed: 0, unchanged: 0 }
      : await resealMeshFiles(meshDirOf(userId), userId, cipher);

  // 5. Remove the retiring keys once nothing names them.
  for (const key of opened.keys.retiring) {
    const left =
      userId === null
        ? 0
        : (await rowsWithKey(sqlRun(), userId, key.keyId)) +
          (await meshFilesWithKey(meshDirOf(userId), key.keyId));
    if (left > 0) return stop(`${left} value(s) still name the old key; run this again.`);
  }
  const { retiring: _retired, ...finished } = opened.record;
  await appendVaultCounts(actorId, "rotate", {
    ...counts,
    meshFiles: meshes.sealed + meshes.resealed,
  });
  await writeRecord(actorId, { ...finished, updatedAt: new Date().toISOString() });
  zeroKeys(opened.keys);
  terminal.say(
    "Done: every value is sealed with the new key, and the old key is removed.",
  );
  terminal.close();
};

await main();
process.exit(0);

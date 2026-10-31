/**
 * What `vault:migrate` and `vault:rotate` share (#141): the database as the
 * reseal ports, the owner's row, the app-stopped check, and opening (or, for
 * a migration, setting up) the person's vault on the terminal. Run with the
 * server-only preload, like the other scripts that use the app's modules.
 */
import { join } from "node:path";

import {
  type OpenedKeys,
  openRecord,
  sealRecord,
  zeroKeys,
} from "../../features/vault/vault-service";
import { database } from "../../infrastructure/database";
import { serverEnv, storageEnv, vaultEnv } from "../../infrastructure/env";
import { type FieldCipher, sealedCipher } from "../../infrastructure/field-cipher";
import { type ResealPorts, type SqlRun } from "../../infrastructure/reseal";
import { appendVaultCounts } from "./vault-audit-append";
import {
  argon2Available,
  newDataKey,
  newKeyId,
  newRecoveryCode,
  passphraseProblem,
} from "../../infrastructure/vault-crypto";
import {
  readVaultRecord,
  type VaultRecord,
  writeVaultRecord,
} from "../../infrastructure/vault-file";
import { type Terminal } from "./terminal";

export { appendVaultCounts };

const isWrite = (sql: string): boolean => /^\s*(UPDATE|DELETE|INSERT)\b/i.test(sql);

const runOn =
  (
    client: Readonly<{
      $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown>;
      $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<number>;
    }>,
  ): SqlRun =>
  async (sql, params) => {
    if (isWrite(sql)) {
      await client.$executeRawUnsafe(sql, ...params);
      return [];
    }
    const rows = await client.$queryRawUnsafe(sql, ...params);
    return Array.isArray(rows) ? rows : [];
  };

export const sqlRun: () => SqlRun = () => runOn(database());

export const resealPorts = (
  progress: (table: string, rows: number) => void,
): ResealPorts => ({
  query: sqlRun(),
  transaction: (work) =>
    database().$transaction((tx) => work(runOn(tx)), { timeout: 120_000 }),
  progress,
});

/** Other sessions on this database: the app must be stopped while rows are rewritten. */
export const otherSessions = async (): Promise<number> => {
  const [row] = await sqlRun()(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'",
    [],
  );
  return Number(row?.n ?? 0);
};

export const actorOf = (given: string | null): string =>
  given ?? serverEnv().LOCAL_USER_ID;

export const ownerUserId = async (actorId: string): Promise<string | null> =>
  (
    await database().user.findUnique({
      where: { clerkId: actorId },
      select: { id: true },
    })
  )?.id ?? null;

export const meshDirOf = (userId: string): string =>
  join(storageEnv().vitronicDir, userId);

export const cipherOf = (keys: OpenedKeys): FieldCipher =>
  sealedCipher(keys.active, keys.retiring);

export type Opened = Readonly<{
  record: VaultRecord;
  keys: OpenedKeys;
  passphrase: string;
}>;

/** Asks for the passphrase until it opens the record (three tries). */
export const unlockOnTerminal = async (
  terminal: Terminal,
  actorId: string,
  record: VaultRecord,
): Promise<Opened | null> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const passphrase = await terminal.secret("Passphrase: ");
    const keys = await openRecord(actorId, record, passphrase, "passphrase");
    if (keys !== null) return { record, keys, passphrase };
    terminal.say("That passphrase does not open your data.");
  }
  return null;
};

/**
 * First run of a personal install that has data but no vault yet: a new
 * passphrase (typed twice) and a recovery code shown once, confirmed saved
 * before the key file is written.
 */
export const setUpOnTerminal = async (
  terminal: Terminal,
  actorId: string,
): Promise<Opened | null> => {
  terminal.say(
    "No passphrase is set yet. Choose one; there is no way to read the data without it or the recovery code.",
  );
  const passphrase = await terminal.secret("New passphrase: ");
  const problem = passphraseProblem(passphrase);
  if (problem !== null) {
    terminal.say(problem);
    return null;
  }
  if ((await terminal.secret("Type it again: ")) !== passphrase) {
    terminal.say("The two passphrases differ. Nothing was changed.");
    return null;
  }
  const dek = newDataKey();
  const keyId = newKeyId();
  const recoveryCode = newRecoveryCode();
  const now = new Date();
  const record = await sealRecord({
    actorId,
    keyId,
    dek,
    passphrase,
    recoveryCode,
    createdAt: now.toISOString(),
    now,
    argon2: argon2Available(),
  });
  terminal.say(`Recovery code (shown once): ${recoveryCode}`);
  const saved = await terminal.line('Type "saved" once you have written it down: ');
  if (saved.trim().toLowerCase() !== "saved") {
    dek.fill(0);
    terminal.say("Not confirmed. Nothing was changed.");
    return null;
  }
  await appendVaultCounts(actorId, "setup");
  await writeVaultRecord(vaultEnv().stateDir, actorId, record);
  return { record, keys: { active: { keyId, dataKey: dek }, retiring: [] }, passphrase };
};

export const readRecord = (actorId: string) =>
  readVaultRecord(vaultEnv().stateDir, actorId);

export const writeRecord = (actorId: string, record: VaultRecord) =>
  writeVaultRecord(vaultEnv().stateDir, actorId, record);

export { zeroKeys };

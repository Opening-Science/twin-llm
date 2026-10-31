import { randomBytes } from "node:crypto";

import {
  deriveKek,
  newDataKey,
  newKdfParams,
  newKeyId,
  newRecoveryCode,
  normaliseRecoveryCode,
  passphraseProblem,
  unwrapKey,
  wrapAad,
  wrapKey,
} from "@/infrastructure/vault-crypto";
import { type VaultAuditEvent } from "@/infrastructure/vault-audit";
import {
  type VaultRead,
  type VaultRecord,
  vaultUserKey,
  type WrappedWith,
} from "@/infrastructure/vault-file";
import { type RawKey, type VaultSessions } from "@/infrastructure/vault-session";

import { VAULT_COPY } from "./vault-copy";

/**
 * Set up, unlock, recover and lock one person's vault (#142). The data key is
 * made once at setup, wrapped under the passphrase and under the recovery
 * code, and from then on only rewrapped (recovery). It is unwrapped into the
 * session store and the buffer is zeroed; it never leaves this module
 * otherwise. Every step writes its audit row; an unlock whose row cannot be
 * written is undone. The additional data names the person asking (never the
 * name stored in the file), so one person's file never opens for another.
 */

export type VaultServiceDeps = Readonly<{
  read: (actorId: string) => Promise<VaultRead>;
  write: (actorId: string, record: VaultRecord) => Promise<void>;
  sessions: VaultSessions;
  audit: (actorId: string, event: VaultAuditEvent, failures?: number) => Promise<unknown>;
  now: () => Date;
  /** Argon2id when true, scrypt otherwise (docs/privacy-design.md 2.2). */
  argon2: boolean;
  newToken?: () => string;
  /** Called after a session opens, to start the idle sweep. */
  onOpened?: () => void;
}>;

export type Refused = Readonly<{
  kind: "refused";
  status: 400 | 401 | 409 | 429 | 500 | 503;
  message: string;
  retryAfterSeconds?: number;
}>;

export type Opened = Readonly<{ kind: "opened"; token: string }>;
export type OpenedWithCode = Readonly<{
  kind: "opened";
  token: string;
  recoveryCode: string;
}>;

const refused = (status: Refused["status"], message: string): Refused => ({
  kind: "refused",
  status,
  message,
});

const newSessionToken = (): string => randomBytes(32).toString("base64url");

/** Wraps `dek` under a fresh KEK from `secret`. */
const wrapUnder = async (
  secret: string,
  dek: Buffer,
  aad: Buffer,
  argon2: boolean,
): Promise<WrappedWith> => {
  const kdf = newKdfParams({ argon2 });
  const kek = await deriveKek(secret, kdf);
  try {
    return { kdf, ...wrapKey(kek, dek, aad) };
  } finally {
    kek.fill(0);
  }
};

const openWith = async (
  secret: string,
  wrapped: WrappedWith,
  aad: Buffer,
): Promise<Buffer | null> => {
  const kek = await deriveKek(secret, wrapped.kdf);
  try {
    return unwrapKey(kek, wrapped, aad);
  } finally {
    kek.fill(0);
  }
};

const wrapBoth = async (
  userKey: string,
  keyId: string,
  dek: Buffer,
  passphrase: string,
  code: string,
  argon2: boolean,
): Promise<Readonly<{ passphrase: WrappedWith; recovery: WrappedWith }>> => {
  const [byPassphrase, byCode] = await Promise.all([
    wrapUnder(passphrase, dek, wrapAad(userKey, keyId, "passphrase"), argon2),
    wrapUnder(code, dek, wrapAad(userKey, keyId, "recovery"), argon2),
  ]);
  return { passphrase: byPassphrase, recovery: byCode };
};

/**
 * A record holding `dek` (and any retiring keys of a rotation, #141) under a
 * new passphrase and a new recovery code.
 */
export const sealRecord = async (
  input: Readonly<{
    actorId: string;
    keyId: string;
    dek: Buffer;
    passphrase: string;
    recoveryCode: string;
    createdAt: string;
    now: Date;
    argon2: boolean;
    retiring?: readonly RawKey[];
  }>,
): Promise<VaultRecord> => {
  const userKey = vaultUserKey(input.actorId);
  const code = normaliseRecoveryCode(input.recoveryCode);
  if (code === null) throw new Error("recovery code is not well formed");
  const [active, ...retiring] = await Promise.all(
    [{ keyId: input.keyId, dataKey: input.dek }, ...(input.retiring ?? [])].map(
      async (key) => ({
        keyId: key.keyId,
        ...(await wrapBoth(
          userKey,
          key.keyId,
          key.dataKey,
          input.passphrase,
          code,
          input.argon2,
        )),
      }),
    ),
  );
  if (active === undefined) throw new Error("no key to seal");
  return {
    v: 1,
    userKey,
    keyId: input.keyId,
    createdAt: input.createdAt,
    updatedAt: input.now.toISOString(),
    passphrase: active.passphrase,
    recovery: active.recovery,
    ...(retiring.length > 0 ? { retiring } : {}),
  };
};

export type OpenedKeys = Readonly<{ active: RawKey; retiring: readonly RawKey[] }>;

/**
 * Every data key of a record under the passphrase or the recovery code, or
 * null when the secret is wrong. A retiring key that does not open is a
 * wrong secret too, never a silently smaller keyring.
 */
export const openRecord = async (
  actorId: string,
  record: VaultRecord,
  secret: string,
  purpose: "passphrase" | "recovery",
): Promise<OpenedKeys | null> => {
  const userKey = vaultUserKey(actorId);
  const entries = [
    { keyId: record.keyId, wrapped: record[purpose] },
    ...(record.retiring ?? []).map((key) => ({
      keyId: key.keyId,
      wrapped: key[purpose],
    })),
  ];
  const opened = await Promise.all(
    entries.map(async ({ keyId, wrapped }) => {
      const dataKey = await openWith(
        secret,
        wrapped,
        wrapAad(userKey, keyId, purpose),
      ).catch(() => null);
      return dataKey === null ? null : { keyId, dataKey };
    }),
  );
  const keys = opened.filter((key): key is RawKey => key !== null);
  const [active, ...retiring] = keys;
  if (active === undefined || keys.length !== entries.length) {
    for (const key of keys) key.dataKey.fill(0);
    return null;
  }
  return { active, retiring };
};

export const zeroKeys = (keys: OpenedKeys): void => {
  keys.active.dataKey.fill(0);
  for (const key of keys.retiring) key.dataKey.fill(0);
};

const openSession = (
  deps: VaultServiceDeps,
  actorId: string,
  keys: OpenedKeys,
): string => {
  const token = (deps.newToken ?? newSessionToken)();
  deps.sessions.open(
    actorId,
    keys.active.keyId,
    keys.active.dataKey,
    token,
    keys.retiring,
  );
  zeroKeys(keys);
  deps.onOpened?.();
  return token;
};

const readFound = async (
  deps: VaultServiceDeps,
  actorId: string,
): Promise<VaultRecord | Refused> => {
  const read = await deps.read(actorId);
  if (read.kind === "missing") return refused(409, VAULT_COPY.notSetUp);
  if (read.kind === "unreadable") return refused(500, VAULT_COPY.unreadable);
  return read.record;
};

const tooSoon = (deps: VaultServiceDeps, actorId: string): Refused | null => {
  const waitMs = deps.sessions.retryAfterMs(actorId);
  if (waitMs <= 0) return null;
  const seconds = Math.ceil(waitMs / 1000);
  return { ...refused(429, VAULT_COPY.wait(seconds)), retryAfterSeconds: seconds };
};

/** Counts a wrong attempt and writes its row (a failed row never turns a refusal into a pass). */
const wrongAttempt = async (
  deps: VaultServiceDeps,
  actorId: string,
  event: "unlockRefused" | "recoveryRefused",
  message: string,
): Promise<Refused> => {
  const failures = deps.sessions.noteFailure(actorId);
  await deps.audit(actorId, event, failures).catch(() => undefined);
  return refused(401, message);
};

/** First run: a new data key under the passphrase and a recovery code shown once. */
export const setUpVault = async (
  deps: VaultServiceDeps,
  actorId: string,
  passphrase: string,
): Promise<OpenedWithCode | Refused> => {
  const problem = passphraseProblem(passphrase);
  if (problem !== null) return refused(400, problem);
  const existing = await deps.read(actorId);
  if (existing.kind === "found") return refused(409, VAULT_COPY.alreadySetUp);
  if (existing.kind === "unreadable") return refused(500, VAULT_COPY.unreadable);

  const dek = newDataKey();
  const keyId = newKeyId();
  const recoveryCode = newRecoveryCode();
  const now = deps.now();
  try {
    const record = await sealRecord({
      actorId,
      keyId,
      dek,
      passphrase,
      recoveryCode,
      createdAt: now.toISOString(),
      now,
      argon2: deps.argon2,
    });
    // The row first: a setup that cannot be recorded does not happen.
    await deps.audit(actorId, "setup");
    await deps.write(actorId, record);
  } catch {
    dek.fill(0);
    return refused(503, VAULT_COPY.setupFailed);
  }
  return {
    kind: "opened",
    token: openSession(deps, actorId, { active: { keyId, dataKey: dek }, retiring: [] }),
    recoveryCode,
  };
};

export const unlockVault = async (
  deps: VaultServiceDeps,
  actorId: string,
  passphrase: string,
): Promise<Opened | Refused> => {
  const wait = tooSoon(deps, actorId);
  if (wait !== null) return wait;
  const record = await readFound(deps, actorId);
  if ("kind" in record) return record;

  const keys = await openRecord(actorId, record, passphrase, "passphrase");
  if (keys === null) {
    return wrongAttempt(deps, actorId, "unlockRefused", VAULT_COPY.wrongPassphrase);
  }
  deps.sessions.clearFailures(actorId);
  const token = openSession(deps, actorId, keys);
  try {
    await deps.audit(actorId, "unlock");
  } catch {
    deps.sessions.lock(actorId);
    return refused(503, VAULT_COPY.notRecorded);
  }
  return { kind: "opened", token };
};

/** A forgotten passphrase: the recovery code opens the key, which is rewrapped under a new passphrase and a new code. */
export const recoverVault = async (
  deps: VaultServiceDeps,
  actorId: string,
  code: string,
  newPassphrase: string,
): Promise<OpenedWithCode | Refused> => {
  const wait = tooSoon(deps, actorId);
  if (wait !== null) return wait;
  const normalised = normaliseRecoveryCode(code);
  if (normalised === null) return refused(400, VAULT_COPY.codeShape);
  const problem = passphraseProblem(newPassphrase);
  if (problem !== null) return refused(400, problem);
  const record = await readFound(deps, actorId);
  if ("kind" in record) return record;

  const keys = await openRecord(actorId, record, normalised, "recovery");
  if (keys === null) {
    return wrongAttempt(deps, actorId, "recoveryRefused", VAULT_COPY.wrongCode);
  }
  deps.sessions.clearFailures(actorId);
  const recoveryCode = newRecoveryCode();
  try {
    const rewrapped = await sealRecord({
      actorId,
      keyId: record.keyId,
      dek: keys.active.dataKey,
      passphrase: newPassphrase,
      recoveryCode,
      createdAt: record.createdAt,
      now: deps.now(),
      argon2: deps.argon2,
      retiring: keys.retiring,
    });
    await deps.audit(actorId, "recoveryUsed");
    await deps.write(actorId, rewrapped);
  } catch {
    zeroKeys(keys);
    return refused(503, VAULT_COPY.notRecorded);
  }
  return {
    kind: "opened",
    token: openSession(deps, actorId, keys),
    recoveryCode,
  };
};

/** Locks at once; the row is written after, and a failed row never keeps the vault open. */
export const lockVault = async (
  deps: VaultServiceDeps,
  actorId: string,
): Promise<boolean> => {
  const wasOpen = deps.sessions.lock(actorId);
  if (wasOpen) await deps.audit(actorId, "lockManual").catch(() => undefined);
  return wasOpen;
};

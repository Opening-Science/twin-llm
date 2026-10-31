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
import { type VaultSessions } from "@/infrastructure/vault-session";

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

/** A record holding `dek` under a new passphrase and a new recovery code. */
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
  }>,
): Promise<VaultRecord> => {
  const userKey = vaultUserKey(input.actorId);
  const code = normaliseRecoveryCode(input.recoveryCode);
  if (code === null) throw new Error("recovery code is not well formed");
  const [passphrase, recovery] = await Promise.all([
    wrapUnder(
      input.passphrase,
      input.dek,
      wrapAad(userKey, input.keyId, "passphrase"),
      input.argon2,
    ),
    wrapUnder(code, input.dek, wrapAad(userKey, input.keyId, "recovery"), input.argon2),
  ]);
  return {
    v: 1,
    userKey,
    keyId: input.keyId,
    createdAt: input.createdAt,
    updatedAt: input.now.toISOString(),
    passphrase,
    recovery,
  };
};

const openSession = (
  deps: VaultServiceDeps,
  actorId: string,
  keyId: string,
  dek: Buffer,
): string => {
  const token = (deps.newToken ?? newSessionToken)();
  deps.sessions.open(actorId, keyId, dek, token);
  dek.fill(0);
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
  return { kind: "opened", token: openSession(deps, actorId, keyId, dek), recoveryCode };
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

  const dek = await openWith(
    passphrase,
    record.passphrase,
    wrapAad(vaultUserKey(actorId), record.keyId, "passphrase"),
  ).catch(() => null);
  if (dek === null) {
    return wrongAttempt(deps, actorId, "unlockRefused", VAULT_COPY.wrongPassphrase);
  }
  deps.sessions.clearFailures(actorId);
  const token = openSession(deps, actorId, record.keyId, dek);
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

  const dek = await openWith(
    normalised,
    record.recovery,
    wrapAad(vaultUserKey(actorId), record.keyId, "recovery"),
  ).catch(() => null);
  if (dek === null) {
    return wrongAttempt(deps, actorId, "recoveryRefused", VAULT_COPY.wrongCode);
  }
  deps.sessions.clearFailures(actorId);
  const recoveryCode = newRecoveryCode();
  try {
    const rewrapped = await sealRecord({
      actorId,
      keyId: record.keyId,
      dek,
      passphrase: newPassphrase,
      recoveryCode,
      createdAt: record.createdAt,
      now: deps.now(),
      argon2: deps.argon2,
    });
    await deps.audit(actorId, "recoveryUsed");
    await deps.write(actorId, rewrapped);
  } catch {
    dek.fill(0);
    return refused(503, VAULT_COPY.notRecorded);
  }
  return {
    kind: "opened",
    token: openSession(deps, actorId, record.keyId, dek),
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

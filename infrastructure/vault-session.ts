import {
  createHash,
  createSecretKey,
  type KeyObject,
  timingSafeEqual,
} from "node:crypto";

import { processSingleton } from "./process-singleton";

/**
 * Who is unlocked right now (#142): per actor, the data key as a `KeyObject`,
 * the SHA-256 of the unlock cookie's token, and when it was opened and last
 * used. Only in this process's memory: never written to disk, a log, Prisma,
 * the audit chain or a response. A restart starts with every vault locked.
 *
 * The clock is passed in, so idle locking is tested without waiting. The
 * failed-attempt backoff lives here too, because it is per actor and must
 * reset with the process like the keys do.
 */

export type VaultKeys = Readonly<{
  keyId: string;
  /** The data key; #141 derives its field, index and ledger subkeys from it. */
  dataKey: KeyObject;
}>;

type Session = Readonly<{
  keys: VaultKeys;
  tokenHash: Buffer;
  openedAt: number;
  lastUsedAt: number;
}>;

type Failures = Readonly<{ count: number; lastAt: number }>;

export type SessionCheck =
  | Readonly<{ kind: "unlocked"; keys: VaultKeys }>
  /** Nothing open for this actor. */
  | Readonly<{ kind: "locked" }>
  /** Open, but the cookie's token is missing or not this session's. */
  | Readonly<{ kind: "wrong-token" }>
  /** Was open and sat idle too long; it is locked now. */
  | Readonly<{ kind: "idle-locked" }>;

export const hashToken = (token: string): Buffer =>
  createHash("sha256").update(token, "utf8").digest();

/** 1 s after the first wrong passphrase, doubling to at most 60 s. */
export const backoffMs = (failures: number): number =>
  failures <= 0 ? 0 : Math.min(60_000, 1000 * 2 ** (failures - 1));

/** The longest a failure count is kept without a new wrong attempt. */
const FAILURE_MEMORY_MS = 60 * 60_000;

export type VaultSessions = Readonly<{
  /** Opens (or replaces) the actor's session; `dataKey` bytes are copied into a KeyObject. */
  open: (actorId: string, keyId: string, dataKey: Buffer, token: string) => void;
  /** Checks the token and, when it holds, marks the session used now. */
  check: (actorId: string, token: string | null, idleMs: number) => SessionCheck;
  /** True when the token opens the actor's session now; unlike `check`, it does not count as use. */
  holds: (actorId: string, token: string | null, idleMs: number) => boolean;
  /** True when the actor has an open session that is not idle, whatever the cookie. */
  isOpen: (actorId: string, idleMs: number) => boolean;
  /** Locks one actor; true when something was open. */
  lock: (actorId: string) => boolean;
  /** Locks every session idle longer than `idleMs`; returns the actors locked. */
  sweep: (idleMs: number) => readonly string[];
  /** Milliseconds before the actor may try another passphrase. */
  retryAfterMs: (actorId: string) => number;
  /** Counts a wrong passphrase or code; returns the new count. */
  noteFailure: (actorId: string) => number;
  clearFailures: (actorId: string) => void;
}>;

export const createVaultSessions = (now: () => number): VaultSessions => {
  const sessions = new Map<string, Session>();
  const failures = new Map<string, Failures>();

  const idle = (session: Session, idleMs: number): boolean =>
    now() - session.lastUsedAt >= idleMs;

  const failuresOf = (actorId: string): Failures | null => {
    const found = failures.get(actorId);
    if (found === undefined) return null;
    if (now() - found.lastAt >= FAILURE_MEMORY_MS) {
      failures.delete(actorId);
      return null;
    }
    return found;
  };

  return {
    open: (actorId, keyId, dataKey, token) => {
      const at = now();
      sessions.set(actorId, {
        keys: { keyId, dataKey: createSecretKey(Buffer.from(dataKey)) },
        tokenHash: hashToken(token),
        openedAt: at,
        lastUsedAt: at,
      });
    },
    check: (actorId, token, idleMs) => {
      const session = sessions.get(actorId);
      if (session === undefined) return { kind: "locked" };
      if (idle(session, idleMs)) {
        sessions.delete(actorId);
        return { kind: "idle-locked" };
      }
      if (token === null || !timingSafeEqual(hashToken(token), session.tokenHash)) {
        return { kind: "wrong-token" };
      }
      sessions.set(actorId, { ...session, lastUsedAt: now() });
      return { kind: "unlocked", keys: session.keys };
    },
    holds: (actorId, token, idleMs) => {
      const session = sessions.get(actorId);
      return (
        session !== undefined &&
        !idle(session, idleMs) &&
        token !== null &&
        timingSafeEqual(hashToken(token), session.tokenHash)
      );
    },
    isOpen: (actorId, idleMs) => {
      const session = sessions.get(actorId);
      return session !== undefined && !idle(session, idleMs);
    },
    lock: (actorId) => sessions.delete(actorId),
    sweep: (idleMs) => {
      const locked = [...sessions.entries()]
        .filter(([, session]) => idle(session, idleMs))
        .map(([actorId]) => actorId);
      for (const actorId of locked) sessions.delete(actorId);
      return locked;
    },
    retryAfterMs: (actorId) => {
      const found = failuresOf(actorId);
      if (found === null) return 0;
      return Math.max(0, found.lastAt + backoffMs(found.count) - now());
    },
    noteFailure: (actorId) => {
      const count = (failuresOf(actorId)?.count ?? 0) + 1;
      failures.set(actorId, { count, lastAt: now() });
      return count;
    },
    clearFailures: (actorId) => {
      failures.delete(actorId);
    },
  };
};

/**
 * The process's one session store. Kept on `globalThis` (through
 * `processSingleton`) because Next.js may load this module once per route
 * bundle and again on hot reload; every route must see the same map, or
 * unlocking in one route would not unlock another.
 */
export const vaultSessions: () => VaultSessions = processSingleton(
  "__twinLlmVaultSessions",
  () => createVaultSessions(() => Date.now()),
);

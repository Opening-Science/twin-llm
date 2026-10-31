import "server-only";

import { type AnchorVerdict, anchorVerdict, type LogRead } from "@/packages/audit/anchor";
import { chainReaders, factsAt } from "@/packages/audit/anchor-chains";
import {
  type AnchorPaths,
  anchorPaths,
  diskKeyOf,
  logStamp,
  readAnchorKey,
  readAnchorLog,
} from "@/packages/audit/anchor-store";
import type { ChainName } from "@/packages/audit/chain";

import { createAnchorWriter } from "./anchor-writer";
import { database } from "./database";
import { anchorEnv } from "./env";

/**
 * Signed anchors on the server (#300): the writer started from
 * `instrumentation.ts`, and the verdict the Lab cards show. The heads are
 * read every minute (or every interval, when that is shorter); anchors are
 * written at most once per AUDIT_ANCHOR_INTERVAL_MINUTES, and once more on
 * SIGTERM or SIGINT from what the last read found.
 */

const POLL_MS = 60_000;
const STARTED = Symbol.for("twinllm.anchor-writer");

type WithFlag = typeof globalThis & { [STARTED]?: true };

export const startAnchorWriter = (): void => {
  const flag = globalThis as WithFlag;
  if (flag[STARTED]) return;
  flag[STARTED] = true;
  const env = anchorEnv();
  const writer = createAnchorWriter({
    readers: chainReaders(database()),
    paths: anchorPaths(env.stateDir),
    intervalMs: env.intervalMs,
    now: () => new Date(),
    log: (message) => console.warn(message),
  });
  void writer.poll();
  setInterval(() => void writer.poll(), Math.min(POLL_MS, env.intervalMs)).unref();
  const onSignal = (): void => {
    writer.flush();
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
};

/** The file's check, kept while the file is unchanged: signatures are not checked again per load. */
const logCache: { stamp: string | null; log: LogRead | null } = {
  stamp: null,
  log: null,
};

const cachedLog = (paths: AnchorPaths): LogRead => {
  const stamp = logStamp(paths);
  if (stamp !== null && stamp === logCache.stamp && logCache.log !== null) {
    return logCache.log;
  }
  const log = readAnchorLog(paths);
  logCache.stamp = stamp;
  logCache.log = log;
  return log;
};

/** One chain against its latest signed anchor, and the current public key, for the Lab. */
export const anchorViewFor = async (
  chain: ChainName,
): Promise<Readonly<{ verdict: AnchorVerdict; publicKey: string | null }>> => {
  const paths = anchorPaths(anchorEnv().stateDir);
  const loaded = readAnchorKey(paths);
  const key = diskKeyOf(loaded);
  const log = key.kind === "found" ? cachedLog(paths) : ({ kind: "missing" } as const);
  const anchor = log.kind === "found" ? log.check.state.latest[chain] : undefined;
  const verdict = anchorVerdict({
    chain,
    key,
    log,
    facts: await factsAt(chainReaders(database())[chain], anchor),
  });
  return { verdict, publicKey: loaded.kind === "found" ? loaded.publicKey : null };
};

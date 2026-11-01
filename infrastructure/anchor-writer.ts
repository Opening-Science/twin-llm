import { databaseGate, databaseMismatchMessage } from "@/packages/audit/anchor";
import {
  type ChainPlan,
  type ChainReader,
  type DatabaseIdentity,
  dueHeads,
  planFromFile,
} from "@/packages/audit/anchor-chains";
import {
  AnchorDatabaseMismatch,
  anchoredDatabase,
  type AnchorPaths,
  type DueHead,
  readAnchorKey,
  writeAnchors,
} from "@/packages/audit/anchor-store";
import type { ChainName } from "@/packages/audit/chain";

/**
 * The server's anchor writer (#300). `poll` reads each chain's head and, once
 * the interval has passed since the last write, signs and appends an anchor
 * for every chain whose head moved on. It never anchors a chain that is now
 * shorter or different from its latest anchor; it logs that once instead.
 * `flush` writes what the last poll found, synchronously, for a clean
 * shutdown, so the head written then is at most one poll old.
 *
 * The anchors file belongs to one database (#382). When it names another,
 * nothing is written and the log says `ANCHOR_DATABASE_MISMATCH` once. A file
 * from before #382 names none; it takes this database's identity with the
 * next anchor, unless a chain does not match it (then it may be another
 * database's, and nothing is written).
 *
 * A failure is logged by error name and retried at the next poll; it never
 * reaches a request. Nothing here sends anything off the machine.
 */

export type AnchorWriterDeps = Readonly<{
  readers: Readonly<Record<ChainName, ChainReader>>;
  identity: DatabaseIdentity;
  paths: AnchorPaths;
  intervalMs: number;
  now: () => Date;
  log: (message: string) => void;
}>;

export type AnchorWriter = Readonly<{
  poll: () => Promise<readonly ChainPlan[]>;
  flush: () => number;
}>;

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

const REFUSED = new Set(["truncated", "removed", "rewritten"]);

export const createAnchorWriter = (deps: AnchorWriterDeps): AnchorWriter => {
  const state: {
    pending: readonly DueHead[];
    databaseId: string | null;
    lastWrite: number;
    said: Set<string>;
  } = {
    pending: [],
    databaseId: null,
    lastWrite: Number.NEGATIVE_INFINITY,
    said: new Set(),
  };
  const once = (key: string, message: string): void => {
    if (state.said.has(key)) return;
    state.said.add(key);
    deps.log(message);
  };
  const write = (): number => {
    const due = state.pending;
    const databaseId = state.databaseId;
    if (due.length === 0 || databaseId === null) return 0;
    try {
      const written = writeAnchors(deps.paths, due, deps.now(), databaseId);
      state.pending = [];
      state.lastWrite = deps.now().getTime();
      return written.filter((line) => line.kind === "anchor").length;
    } catch (error) {
      state.pending = [];
      if (error instanceof AnchorDatabaseMismatch) {
        once("database-mismatch", `[anchor] ${error.message}`);
        return 0;
      }
      deps.log(`[anchor] could not write anchors: ${errorName(error)}`);
      return 0;
    }
  };

  const poll = async (): Promise<readonly ChainPlan[]> => {
    const key = readAnchorKey(deps.paths);
    if (key.kind !== "found") {
      once(
        `key-${key.kind}`,
        key.kind === "missing"
          ? "[anchor] no anchor key, so no anchors are written; run bun run anchor:init"
          : "[anchor] the anchor key could not be read, so no anchors are written",
      );
      state.pending = [];
      return [];
    }
    try {
      const logDatabaseId = anchoredDatabase(deps.paths);
      const current = await deps.identity.read();
      if (logDatabaseId !== null && logDatabaseId !== current) {
        once(
          "database-mismatch",
          `[anchor] ${databaseMismatchMessage({ logDatabaseId, databaseId: current })}`,
        );
        state.pending = [];
        return [];
      }
      const plans = await planFromFile(deps.readers, deps.paths);
      const gate = databaseGate({
        logDatabaseId,
        databaseId: current,
        plans: plans.map((plan) => (plan.plan === "unreadable" ? "empty" : plan.plan)),
      });
      if (gate.kind === "hold") {
        once(
          "database-hold",
          "[anchor] the anchors file names no database yet and a chain does not match it, so it is not tied to this database; no anchors are written",
        );
      }
      for (const plan of plans) {
        if (REFUSED.has(plan.plan)) {
          once(
            `${plan.chain}-${plan.plan}`,
            `[anchor] the ${plan.chain} chain does not match its latest anchor (${plan.plan}); no new anchor is written over it`,
          );
        }
      }
      state.pending = gate.kind === "go" ? dueHeads(plans) : [];
      if (state.pending.length > 0) {
        state.databaseId = current ?? (await deps.identity.ensure());
      }
      if (deps.now().getTime() - state.lastWrite >= deps.intervalMs) write();
      return plans;
    } catch (error) {
      deps.log(
        `[anchor] could not read the chains or the anchors file: ${errorName(error)}`,
      );
      return [];
    }
  };

  return { poll, flush: write };
};

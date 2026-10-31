import {
  type ChainPlan,
  type ChainReader,
  dueHeads,
  planFromFile,
} from "@/packages/audit/anchor-chains";
import {
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
 * A failure is logged by error name and retried at the next poll; it never
 * reaches a request. Nothing here sends anything off the machine.
 */

export type AnchorWriterDeps = Readonly<{
  readers: Readonly<Record<ChainName, ChainReader>>;
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
  const state: { pending: readonly DueHead[]; lastWrite: number; said: Set<string> } = {
    pending: [],
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
    if (due.length === 0) return 0;
    try {
      const written = writeAnchors(deps.paths, due, deps.now());
      state.pending = [];
      state.lastWrite = deps.now().getTime();
      return written.length;
    } catch (error) {
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
      const plans = await planFromFile(deps.readers, deps.paths);
      for (const plan of plans) {
        if (REFUSED.has(plan.plan)) {
          once(
            `${plan.chain}-${plan.plan}`,
            `[anchor] the ${plan.chain} chain does not match its latest anchor (${plan.plan}); no new anchor is written over it`,
          );
        }
      }
      state.pending = dueHeads(plans);
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

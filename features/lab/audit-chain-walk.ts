import { GENESIS_PREV_HASH } from "@/packages/audit/hash";
import { type ChainRow, firstBrokenIndex } from "@/packages/audit/verify-chain";

/**
 * Walks the audit chain for the Lab page without holding up the server. Rows
 * are read in pages of AUDIT_PAGE_SIZE, the event loop gets a turn between
 * pages, and one page load reads at most AUDIT_ROWS_PER_LOAD rows. Where the
 * walk got to is kept (the last row checked, by `seq` and hash), so the next
 * load goes on from there and later loads read only new rows. If that row is
 * gone or its hash changed, the walk starts again from the first row.
 *
 * Rows already checked are not read again while the server runs, so a change
 * to an older row shows up after a restart or with `verify-cli.ts --check`,
 * which reads every row.
 */

export const AUDIT_PAGE_SIZE = 2_000;
export const AUDIT_ROWS_PER_LOAD = 50_000;

export type AuditAnchor = Readonly<{ seq: bigint; hash: string }>;

export type AuditWalkState = Readonly<{
  /** The last row checked, or the broken row. */
  anchor: AuditAnchor | null;
  checked: number;
  brokenAtSeq: number | null;
}>;

export const AUDIT_WALK_START: AuditWalkState = {
  anchor: null,
  checked: 0,
  brokenAtSeq: null,
};

export type AuditWalkIo = Readonly<{
  count: () => Promise<number>;
  rowAt: (seq: bigint) => Promise<ChainRow | null>;
  /** Rows with `seq` above `after` (all rows when null), ascending, at most `take`. */
  rowsAfter: (after: bigint | null, take: number) => Promise<readonly ChainRow[]>;
  yieldNow: () => Promise<void>;
}>;

export type AuditWalk = Readonly<{
  state: AuditWalkState;
  total: number;
  /** False when this load stopped at its row budget with rows left. */
  complete: boolean;
}>;

export type AuditWalkLimits = Readonly<{ pageSize: number; maxRows: number }>;

const DEFAULT_LIMITS: AuditWalkLimits = {
  pageSize: AUDIT_PAGE_SIZE,
  maxRows: AUDIT_ROWS_PER_LOAD,
};

/** The saved state, or the start when the row it ended on is gone or changed. */
const resume = async (
  io: AuditWalkIo,
  saved: AuditWalkState,
): Promise<AuditWalkState> => {
  if (saved.anchor === null) return AUDIT_WALK_START;
  const row = await io.rowAt(saved.anchor.seq);
  return row !== null && row.hash === saved.anchor.hash ? saved : AUDIT_WALK_START;
};

export const walkAuditChain = async (
  io: AuditWalkIo,
  saved: AuditWalkState,
  limits: AuditWalkLimits = DEFAULT_LIMITS,
): Promise<AuditWalk> => {
  const total = await io.count();
  const start = await resume(io, saved);
  if (start.brokenAtSeq !== null) return { state: start, total, complete: true };

  const step = async (state: AuditWalkState, read: number): Promise<AuditWalk> => {
    const take = Math.min(limits.pageSize, limits.maxRows - read);
    if (take <= 0) {
      return { state, total: Math.max(total, state.checked), complete: false };
    }
    const rows = await io.rowsAfter(state.anchor?.seq ?? null, take);
    const broken = firstBrokenIndex(rows, state.anchor?.hash ?? GENESIS_PREV_HASH);
    if (broken !== -1) {
      const row = rows[broken];
      return {
        state: {
          anchor: { seq: BigInt(row.seq), hash: row.hash },
          checked: state.checked + broken + 1,
          brokenAtSeq: Number(row.seq),
        },
        total: Math.max(total, state.checked + broken + 1),
        complete: true,
      };
    }
    const last = rows.at(-1);
    const next: AuditWalkState =
      last === undefined
        ? state
        : {
            anchor: { seq: BigInt(last.seq), hash: last.hash },
            checked: state.checked + rows.length,
            brokenAtSeq: null,
          };
    if (rows.length < take) {
      return { state: next, total: Math.max(total, next.checked), complete: true };
    }
    if (read + rows.length >= limits.maxRows) {
      return { state: next, total: Math.max(total, next.checked), complete: false };
    }
    await io.yieldNow();
    return step(next, read + rows.length);
  };

  return step(start, 0);
};

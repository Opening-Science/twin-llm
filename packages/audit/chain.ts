import { GENESIS_PREV_HASH } from "./hash";

export { hashLink } from "./hash";

/**
 * The hash chain both TwinLLM chains share: the audit log (`audit_events`)
 * and the disclosure ledger (`disclosure_events`, #140). A row's hash is
 * SHA-256 of the previous row's hash followed by the row's canonical JSON
 * (sorted keys, no `hash`), and each row stores the hash of the row before.
 * Each chain only says which fields its canonical form holds.
 *
 * Pure: no database, no clock.
 */

/** The two chains: the audit log and the disclosure ledger. */
export const CHAINS = ["audit", "disclosures"] as const;

export type ChainName = (typeof CHAINS)[number];

export type ChainLink = Readonly<{
  seq: bigint | number;
  prevHash: string;
  hash: string;
}>;

/** The `seq` and `prevHash` of the row after `last` (the first row when null). */
export const nextLink = (
  last: Readonly<{ seq: bigint; hash: string }> | null,
): Readonly<{ seq: bigint; prevHash: string }> => ({
  seq: last === null ? BigInt(1) : last.seq + BigInt(1),
  prevHash: last?.hash ?? GENESIS_PREV_HASH,
});

export type VerifyChainResult = (
  | { readonly ok: true; readonly brokenAtSeq: null }
  | { readonly ok: false; readonly brokenAtSeq: number }
) & {
  readonly checked: number;
  readonly total: number;
  readonly latestHash: string | null;
};

/**
 * The index of the first row in `rows` whose recomputed hash differs from
 * the stored one, or that does not point at the row before (`prevHash` for
 * the first), or -1. `rehash` recomputes a row's hash from its fields.
 */
export const firstBrokenLink = <Row extends ChainLink>(
  rows: readonly Row[],
  rehash: (row: Row) => string,
  prevHash: string = GENESIS_PREV_HASH,
): number =>
  rows.findIndex(
    (row, index) =>
      row.prevHash !== (index === 0 ? prevHash : rows[index - 1].hash) ||
      rehash(row) !== row.hash,
  );

/** Walks rows already in ascending `seq` order. */
export const checkLinks = <Row extends ChainLink>(
  rows: readonly Row[],
  rehash: (row: Row) => string,
): VerifyChainResult => {
  const total = rows.length;
  const latestHash = rows.at(-1)?.hash ?? null;
  const brokenIndex = firstBrokenLink(rows, rehash);
  return brokenIndex === -1
    ? { ok: true, brokenAtSeq: null, checked: total, total, latestHash }
    : {
        ok: false,
        brokenAtSeq: Number(rows[brokenIndex].seq),
        checked: brokenIndex + 1,
        total,
        latestHash,
      };
};

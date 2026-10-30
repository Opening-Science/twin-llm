import { formatNumber } from "@/infrastructure/format-measure";
import type { VerifyChainResult } from "@/packages/audit/verify-chain";

import { type LabCheck, plural, shortHash } from "./lab-check";

/**
 * The audit log's hash chain, walked by `verifyChain()` on the server. Each
 * row's hash covers the row and the hash before it, so changing or removing a
 * row in the middle shows up here. `null` means the table could not be read.
 *
 * The walk reads every row, about 0.3 s of hashing per 100,000 rows plus the
 * database read, so above AUDIT_PAGE_ROW_LIMIT the page leaves it to the
 * command instead of holding up the load.
 */

export const AUDIT_PAGE_ROW_LIMIT = 200_000;

export type TooManyRows = Readonly<{ kind: "too-many"; total: number }>;

const HOW_TO = "bun --env-file=.env.local packages/audit/verify-cli.ts --check";

const base = { id: "audit-chain", title: "Audit chain", howTo: HOW_TO } as const;

export const auditChainCheck = (
  result: VerifyChainResult | TooManyRows | null,
): LabCheck => {
  if (result === null) {
    return {
      ...base,
      status: "unknown",
      summary:
        "The audit table could not be read just now. Check that the database is running.",
      evidence: [],
    };
  }
  if ("kind" in result) {
    return {
      ...base,
      status: "unknown",
      summary: `The audit log has ${plural(result.total, "row")}, more than the ${formatNumber(AUDIT_PAGE_ROW_LIMIT, 0)} this page walks on load. Run the command below to check the whole chain.`,
      evidence: [{ label: "Rows", value: formatNumber(result.total, 0) }],
    };
  }
  const evidence = [
    {
      label: "Rows checked",
      value: `${formatNumber(result.checked, 0)} of ${formatNumber(result.total, 0)}`,
    },
    {
      label: "First broken link",
      value: result.ok ? "none" : `row ${result.brokenAtSeq}`,
      mono: !result.ok,
    },
    { label: "Latest hash", value: shortHash(result.latestHash, 16), mono: true },
  ];
  if (result.total === 0) {
    return {
      ...base,
      status: "unknown",
      summary: "The audit log has no rows yet, so there is no chain to check.",
      evidence,
    };
  }
  return result.ok
    ? {
        ...base,
        status: "ok",
        summary: `All ${plural(result.total, "row")} hash correctly, and each one points at the row before it.`,
        evidence,
      }
    : {
        ...base,
        status: "not-ok",
        summary: `Row ${result.brokenAtSeq} does not match its hash or its link to the row before. Rows after it were not checked.`,
        evidence,
      };
};

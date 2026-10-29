import { formatNumber } from "@/infrastructure/format-measure";
import type { VerifyChainResult } from "@/packages/audit/verify-chain";

import { type LabCheck, plural, shortHash } from "./lab-check";

/**
 * The audit log's hash chain, walked by `verifyChain()` on the server. Each
 * row's hash covers the row and the hash before it, so changing or removing a
 * row in the middle shows up here. `null` means the table could not be read.
 */

const HOW_TO = "bun --env-file=.env.local packages/audit/verify-cli.ts --check";

const base = { id: "audit-chain", title: "Audit chain", howTo: HOW_TO } as const;

export const auditChainCheck = (result: VerifyChainResult | null): LabCheck => {
  if (result === null) {
    return {
      ...base,
      status: "unknown",
      summary:
        "The audit table could not be read just now. Check that the database is running.",
      evidence: [],
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

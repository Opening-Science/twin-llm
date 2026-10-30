import { formatNumber } from "@/infrastructure/format-measure";

import { AUDIT_ROWS_PER_LOAD, type AuditWalk } from "./audit-chain-walk";
import { type LabCheck, plural, shortHash } from "./lab-check";

/**
 * The audit log's hash chain, walked a page at a time on the server
 * (`audit-chain-walk.ts`). Each row's hash covers the row and the hash before
 * it, so changing or removing a row in the middle shows up here. `null` means
 * the table could not be read.
 */

const HOW_TO = "bun --env-file=.env.local packages/audit/verify-cli.ts --check";

/** What the card shows even when the check cannot run. */
export const auditChainBase = {
  id: "audit-chain",
  title: "Audit chain",
  howTo: HOW_TO,
} as const;

const base = auditChainBase;

export const auditChainCheck = (walk: AuditWalk | null): LabCheck => {
  if (walk === null) {
    return {
      ...base,
      status: "unknown",
      summary:
        "The audit table could not be read just now. Check that the database is running.",
      evidence: [],
    };
  }
  const { state, total, complete } = walk;
  const broken = state.brokenAtSeq;
  const evidence = [
    {
      label: "Rows checked",
      value: `${formatNumber(state.checked, 0)} of ${formatNumber(total, 0)}`,
    },
    {
      label: "First broken link",
      value: broken === null ? "none" : `row ${broken}`,
      mono: broken !== null,
    },
    {
      label: "Latest hash checked",
      value: broken === null ? shortHash(state.anchor?.hash, 16) : "—",
      mono: true,
    },
  ];
  if (broken !== null) {
    return {
      ...base,
      status: "not-ok",
      summary: `Row ${broken} does not match its hash or its link to the row before. Rows after it were not checked.`,
      evidence,
    };
  }
  if (total === 0) {
    return {
      ...base,
      status: "unknown",
      summary: "The audit log has no rows yet, so there is no chain to check.",
      evidence,
    };
  }
  if (!complete) {
    return {
      ...base,
      status: "unknown",
      summary: `Checked ${formatNumber(state.checked, 0)} of ${plural(total, "row")} so far. The page reads at most ${formatNumber(AUDIT_ROWS_PER_LOAD, 0)} rows per load so the server stays responsive; reload to go on, or run the command below to check the whole chain now.`,
      evidence,
    };
  }
  return {
    ...base,
    status: "ok",
    summary: `All ${plural(state.checked, "row")} hash correctly, and each one points at the row before it. Rows already checked are not read again while the server runs; the command below reads every row.`,
    evidence,
  };
};

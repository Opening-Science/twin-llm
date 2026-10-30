import { describe, expect, test } from "bun:test";

import { auditChainBase, auditChainCheck } from "./audit-chain-check";
import { AUDIT_WALK_START, type AuditWalk } from "./audit-chain-walk";
import { unavailableCheck } from "./lab-check";

const HASH = "a".repeat(64);

const walk = (
  checked: number,
  total: number,
  complete = true,
  brokenAtSeq: number | null = null,
): AuditWalk => ({
  state: {
    anchor: checked === 0 ? null : { seq: BigInt(checked), hash: HASH },
    checked,
    brokenAtSeq,
  },
  total,
  complete,
});

describe("auditChainCheck", () => {
  test("an unreadable table is unknown", () => {
    const check = auditChainCheck(null);
    expect(check.status).toBe("unknown");
    expect(check.evidence).toEqual([]);
    expect(unavailableCheck(auditChainBase).howTo).toBe(check.howTo);
  });

  test("an empty table is unknown, with nothing to check", () => {
    const check = auditChainCheck({ state: AUDIT_WALK_START, total: 0, complete: true });
    expect(check.status).toBe("unknown");
    expect(check.evidence).toEqual([
      { label: "Rows checked", value: "0 of 0" },
      { label: "First broken link", value: "none", mono: false },
      { label: "Latest hash checked", value: "—", mono: true },
    ]);
  });

  test("a walk that stopped at its budget is unknown and says how far it got", () => {
    const check = auditChainCheck(walk(50_000, 250_000, false));
    expect(check.status).toBe("unknown");
    expect(check.summary).toBe(
      "Checked 50,000 of 250,000 rows so far. The page reads at most 50,000 rows per load so the server stays responsive; reload to go on, or run the command below to check the whole chain now.",
    );
  });

  test("a whole chain is ok", () => {
    const check = auditChainCheck(walk(1200, 1200));
    expect(check.status).toBe("ok");
    expect(check.summary).toStartWith(
      "All 1,200 rows hash correctly, and each one points at the row before it.",
    );
    expect(check.evidence[2]).toEqual({
      label: "Latest hash checked",
      value: "aaaaaaaaaaaaaaaa",
      mono: true,
    });
  });

  test("a broken chain names the first broken row", () => {
    const check = auditChainCheck(walk(4, 20, true, 4));
    expect(check.status).toBe("not-ok");
    expect(check.evidence.slice(0, 2)).toEqual([
      { label: "Rows checked", value: "4 of 20" },
      { label: "First broken link", value: "row 4", mono: true },
    ]);
  });
});

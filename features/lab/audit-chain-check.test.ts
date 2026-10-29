import { describe, expect, test } from "bun:test";

import { auditChainCheck } from "./audit-chain-check";

const HASH = "a".repeat(64);

describe("auditChainCheck", () => {
  test("an unreadable table is unknown", () => {
    const check = auditChainCheck(null);
    expect(check.status).toBe("unknown");
    expect(check.evidence).toEqual([]);
  });

  test("an empty table is unknown, with nothing to check", () => {
    const check = auditChainCheck({
      ok: true,
      brokenAtSeq: null,
      checked: 0,
      total: 0,
      latestHash: null,
    });
    expect(check.status).toBe("unknown");
    expect(check.evidence).toEqual([
      { label: "Rows checked", value: "0 of 0" },
      { label: "First broken link", value: "none", mono: false },
      { label: "Latest hash", value: "—", mono: true },
    ]);
  });

  test("a whole chain is ok", () => {
    const check = auditChainCheck({
      ok: true,
      brokenAtSeq: null,
      checked: 1200,
      total: 1200,
      latestHash: HASH,
    });
    expect(check.status).toBe("ok");
    expect(check.summary).toBe(
      "All 1,200 rows hash correctly, and each one points at the row before it.",
    );
    expect(check.evidence[2]).toEqual({
      label: "Latest hash",
      value: "aaaaaaaaaaaaaaaa",
      mono: true,
    });
  });

  test("a broken chain names the first broken row", () => {
    const check = auditChainCheck({
      ok: false,
      brokenAtSeq: 4,
      checked: 4,
      total: 20,
      latestHash: HASH,
    });
    expect(check.status).toBe("not-ok");
    expect(check.evidence.slice(0, 2)).toEqual([
      { label: "Rows checked", value: "4 of 20" },
      { label: "First broken link", value: "row 4", mono: true },
    ]);
  });
});

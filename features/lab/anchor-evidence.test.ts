import { describe, expect, test } from "bun:test";

import type { AnchorRecord, AnchorVerdict } from "@/packages/audit/anchor";

import { anchorEvidence, withAnchor, worseStatus } from "./anchor-evidence";
import type { LabCheck } from "./lab-check";

const KEY_ID = "e".repeat(64);
const PUBLIC = "synthetic-public-key-text";

const ANCHOR: AnchorRecord = {
  v: 1,
  kind: "anchor",
  at: "2026-10-31T12:00:00.000Z",
  keyId: KEY_ID,
  prev: "0".repeat(64),
  sig: "c2ln",
  chain: "audit",
  seq: 12,
  hash: "f".repeat(64),
  headTs: "2026-10-31T11:58:00.000Z",
};

const CHAIN_OK: LabCheck = {
  id: "audit-chain",
  title: "Audit chain",
  status: "ok",
  summary: "All 12 rows hash correctly.",
  evidence: [{ label: "Rows checked", value: "12 of 12" }],
  howTo: "verify",
};

const ok: AnchorVerdict = { status: "ok", anchor: ANCHOR, keyId: KEY_ID };

describe("anchor evidence on the chain cards (#300)", () => {
  test("worse status: Not OK over Unknown over OK", () => {
    expect(worseStatus("ok", "unknown")).toBe("unknown");
    expect(worseStatus("not-ok", "unknown")).toBe("not-ok");
    expect(worseStatus("ok", "ok")).toBe("ok");
  });

  test("a matching anchor keeps the card OK and shows the anchor and the key", () => {
    const check = withAnchor(CHAIN_OK, { verdict: ok, publicKey: PUBLIC }, "audit");
    expect(check.status).toBe("ok");
    expect(check.summary).toBe(
      "All 12 rows hash correctly. The audit chain matches its latest signed anchor (row 12).",
    );
    expect(check.evidence).toEqual([
      { label: "Rows checked", value: "12 of 12" },
      { label: "Latest signed anchor", value: "row 12, 31 Oct 2026, 12:00 UTC" },
      { label: "Anchor check", value: "signature OK, chain matches" },
      { label: "Anchor key id", value: "eeeeeeeeeeeeeeee", mono: true },
      { label: "Anchor public key", value: PUBLIC, mono: true },
    ]);
  });

  test("an empty chain after truncation is Not OK, not Unknown", () => {
    const empty: LabCheck = { ...CHAIN_OK, status: "unknown", summary: "No rows yet." };
    const check = withAnchor(
      empty,
      {
        verdict: {
          status: "not-ok",
          reason: "truncated",
          anchor: ANCHOR,
          line: null,
          keyId: KEY_ID,
        },
        publicKey: PUBLIC,
      },
      "audit",
    );
    expect(check.status).toBe("not-ok");
    expect(check.summary).toBe(
      "No rows yet. The audit chain is shorter than its latest signed anchor (row 12), so rows were removed from its end.",
    );
    expect(check.evidence[2]).toEqual({
      label: "Anchor check",
      value: "chain shorter than the anchor",
    });
  });

  test("no key turns an OK chain into Unknown and says how to start", () => {
    const check = withAnchor(
      CHAIN_OK,
      {
        verdict: {
          status: "unknown",
          reason: "no-key",
          anchor: null,
          line: null,
          keyId: null,
        },
        publicKey: null,
      },
      "disclosures",
    );
    expect(check.status).toBe("unknown");
    expect(check.summary).toBe(
      "All 12 rows hash correctly. Signed anchors are off: there is no anchor key yet. Create one with `bun run anchor:init`.",
    );
    expect(anchorEvidence({ verdict: ok, publicKey: null })).toHaveLength(3);
  });

  test("an anchor that could not be read is Unknown", () => {
    const check = withAnchor(CHAIN_OK, null, "audit");
    expect(check.status).toBe("unknown");
    expect(check.evidence.at(-1)).toEqual({
      label: "Signed anchor",
      value: "could not be read",
    });
  });

  test("another database's anchors file is Not OK and names both databases (#382)", () => {
    const verdict: AnchorVerdict = {
      status: "not-ok",
      reason: "database-mismatch",
      anchor: ANCHOR,
      line: null,
      keyId: KEY_ID,
      databases: { log: "a".repeat(64), current: null },
    };
    const card = withAnchor(CHAIN_OK, { verdict, publicKey: PUBLIC }, "audit");
    expect(card.status).toBe("not-ok");
    expect(card.summary).toContain("belongs to another database");
    expect(card.evidence).toContainEqual({
      label: "Anchor check",
      value: "anchors file is for another database",
    });
    expect(card.evidence).toContainEqual({
      label: "Anchors file database",
      value: "a".repeat(12),
      mono: true,
    });
    expect(card.evidence).toContainEqual({
      label: "This database",
      value: "none yet",
      mono: false,
    });
  });
});

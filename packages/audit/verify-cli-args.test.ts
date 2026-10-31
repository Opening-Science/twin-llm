import { describe, expect, test } from "bun:test";

import {
  anchorOutcome,
  checkOutcome,
  EXIT,
  parseAnchorOption,
  parseChain,
  parseVerifyMode,
  worstExit,
} from "./verify-cli-args";

const HASH = "a".repeat(64);

describe("parseVerifyMode", () => {
  test("one mode is read", () => {
    expect(parseVerifyMode(["bun", "verify-cli.ts", "--check"])).toEqual({
      mode: "--check",
    });
  });

  test("--check refuses to run with another mode", () => {
    expect(parseVerifyMode(["--check", "--seed-ok"])).toEqual({
      error: "verify-cli: pass only one of --check, --seed-ok",
    });
    expect(parseVerifyMode(["--expect-broken", "--check"])).toEqual({
      error: "verify-cli: pass only one of --check, --expect-broken",
    });
  });

  test("no mode is an error", () => {
    expect(parseVerifyMode([])).toEqual({
      error: "verify-cli: pass --check, --seed-ok or --expect-broken",
    });
  });
});

describe("checkOutcome", () => {
  test("an empty table is unknown with its own exit code, like the Lab card", () => {
    const outcome = checkOutcome({
      ok: true,
      brokenAtSeq: null,
      checked: 0,
      total: 0,
      latestHash: null,
    });
    expect(outcome.code).toBe(EXIT.unknown);
    expect(outcome.code).not.toBe(EXIT.ok);
    expect(outcome.line).toStartWith("verify-audit UNKNOWN");
  });

  test("a whole chain is ok", () => {
    expect(
      checkOutcome({
        ok: true,
        brokenAtSeq: null,
        checked: 3,
        total: 3,
        latestHash: HASH,
      }),
    ).toEqual({
      code: 0,
      stream: "stdout",
      line: `verify-audit OK: 3 rows checked, latest hash ${HASH}`,
    });
  });

  test("a broken chain fails", () => {
    expect(
      checkOutcome({ ok: false, brokenAtSeq: 2, checked: 2, total: 5, latestHash: HASH })
        .code,
    ).toBe(EXIT.broken);
  });
});

describe("--chain (#140)", () => {
  test("the audit chain is the default", () => {
    expect(parseChain(["--check"], "--check")).toEqual({ chain: "audit" });
  });

  test("--chain disclosures checks the disclosure ledger", () => {
    expect(parseChain(["--check", "--chain", "disclosures"], "--check")).toEqual({
      chain: "disclosures",
    });
  });

  test("an unknown chain or a seed mode on the ledger is a usage error", () => {
    expect(parseChain(["--check", "--chain", "other"], "--check")).toEqual({
      error: "verify-cli: --chain takes audit or disclosures",
    });
    expect(parseChain(["--seed-ok", "--chain", "disclosures"], "--seed-ok")).toEqual({
      error: "verify-cli: --seed-ok works on the audit chain only",
    });
  });

  test("the ledger's lines name the ledger", () => {
    expect(
      checkOutcome(
        { ok: true, brokenAtSeq: null, checked: 2, total: 2, latestHash: HASH },
        "disclosures",
      ),
    ).toEqual({
      code: 0,
      stream: "stdout",
      line: `verify-disclosures OK: 2 rows checked, latest hash ${HASH}`,
    });
    expect(
      checkOutcome(
        { ok: true, brokenAtSeq: null, checked: 0, total: 0, latestHash: null },
        "disclosures",
      ),
    ).toEqual({
      code: EXIT.unknown,
      stream: "stderr",
      line: "verify-disclosures UNKNOWN: the disclosure ledger has no rows, so there is no chain to check",
    });
  });
});

describe("anchors on --check (#300)", () => {
  test("on by default, another file with --anchors, off with --no-anchors", () => {
    expect(parseAnchorOption(["--check"], "--check")).toEqual({ anchors: "default" });
    expect(
      parseAnchorOption(["--check", "--anchors", "/x/anchors.jsonl"], "--check"),
    ).toEqual({ anchors: "file", path: "/x/anchors.jsonl" });
    expect(parseAnchorOption(["--check", "--no-anchors"], "--check")).toEqual({
      anchors: "off",
    });
    expect(parseAnchorOption(["--seed-ok"], "--seed-ok")).toEqual({ anchors: "off" });
  });

  test("flags that do not fit together", () => {
    expect(parseAnchorOption(["--check", "--anchors"], "--check")).toEqual({
      error: "verify-cli: --anchors takes the path of an anchors file",
    });
    expect(
      parseAnchorOption(["--check", "--anchors", "a", "--no-anchors"], "--check"),
    ).toEqual({ error: "verify-cli: pass only one of --anchors, --no-anchors" });
    expect(parseAnchorOption(["--seed-ok", "--no-anchors"], "--seed-ok")).toEqual({
      error: "verify-cli: --anchors and --no-anchors go with --check only",
    });
  });

  test("the anchor line and its exit code", () => {
    expect(
      anchorOutcome({
        status: "unknown",
        reason: "no-key",
        anchor: null,
        line: null,
        keyId: null,
      }),
    ).toEqual({
      code: EXIT.unknown,
      stream: "stderr",
      line: "verify-audit anchor UNKNOWN: Signed anchors are off: there is no anchor key yet. Create one with `bun run anchor:init`.",
    });
    const keyId = "b".repeat(64);
    expect(
      anchorOutcome(
        {
          status: "not-ok",
          reason: "truncated",
          anchor: {
            v: 1,
            kind: "anchor",
            at: "2026-10-31T12:00:00.000Z",
            keyId,
            prev: "0".repeat(64),
            sig: "c2ln",
            chain: "disclosures",
            seq: 7,
            hash: "d".repeat(64),
            headTs: "2026-10-31T11:59:00.000Z",
          },
          line: null,
          keyId,
        },
        "disclosures",
      ),
    ).toEqual({
      code: EXIT.broken,
      stream: "stderr",
      line: "verify-disclosures anchor FAIL: The disclosure ledger is shorter than its latest signed anchor (row 7), so rows were removed from its end. Latest anchor: row 7 at 2026-10-31T12:00:00.000Z. Key bbbbbbbbbbbbbbbb.",
    });
  });

  test("Not OK wins over Unknown, which wins over OK", () => {
    expect(worstExit(EXIT.ok, EXIT.ok)).toBe(EXIT.ok);
    expect(worstExit(EXIT.ok, EXIT.unknown)).toBe(EXIT.unknown);
    expect(worstExit(EXIT.unknown, EXIT.broken)).toBe(EXIT.broken);
  });
});

import { describe, expect, test } from "bun:test";

import { checkOutcome, EXIT, parseVerifyMode } from "./verify-cli-args";

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

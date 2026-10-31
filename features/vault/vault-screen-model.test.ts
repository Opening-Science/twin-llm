import { describe, expect, test } from "bun:test";

import { VAULT_COPY } from "./vault-copy";
import {
  errorFrom,
  firstStep,
  newPassphraseProblem,
  recoveryCodeIn,
  VAULT_ROUTE,
} from "./vault-screen-model";

describe("unlock screen model (#142)", () => {
  test("the first step follows the gate's code", () => {
    expect(firstStep("PERSONAL_DATA_NOT_SET_UP")).toBe("setup");
    expect(firstStep("PERSONAL_DATA_LOCKED")).toBe("unlock");
  });

  test("routes per step", () => {
    expect(VAULT_ROUTE).toEqual({
      setup: "/api/vault/setup",
      unlock: "/api/vault/unlock",
      recover: "/api/vault/recover",
    });
  });

  test("a new passphrase must be long enough and typed twice the same", () => {
    expect(newPassphraseProblem("short", "short")).toBe("Use at least 12 characters.");
    expect(newPassphraseProblem("synthetic words", "synthetic word")).toBe(
      VAULT_COPY.mismatch,
    );
    expect(newPassphraseProblem("synthetic words", "synthetic words")).toBe(null);
  });

  test("a recovery code in the answer is shown, else the page reloads", () => {
    expect(recoveryCodeIn({ recoveryCode: "AAAA-BBBB" })).toBe("AAAA-BBBB");
    expect(recoveryCodeIn({ status: "unlocked" })).toBe(null);
    expect(recoveryCodeIn(null)).toBe(null);
  });

  test("the route's sentence, or a fallback", () => {
    expect(errorFrom({ error: "That passphrase did not unlock your data." })).toBe(
      "That passphrase did not unlock your data.",
    );
    expect(errorFrom({})).toBe(VAULT_COPY.failed);
    expect(errorFrom("text")).toBe(VAULT_COPY.failed);
  });

  test("the wait sentence counts seconds", () => {
    expect(VAULT_COPY.wait(1)).toBe("Too many tries. Wait 1 second and try again.");
    expect(VAULT_COPY.wait(4)).toBe("Too many tries. Wait 4 seconds and try again.");
  });
});

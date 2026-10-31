import { afterAll, describe, expect, mock, test } from "bun:test";

import { moduleMocker, withOverrides } from "./mock-module";

const mockModuleForFile = moduleMocker({ mock, afterAll });

describe("withOverrides", () => {
  test("keeps the real exports and replaces only the named ones", () => {
    const real = { a: 1, b: 2 };
    expect(withOverrides(real, { b: 3 })).toEqual({ a: 1, b: 3 });
    expect(real).toEqual({ a: 1, b: 2 });
  });

  test("adds an export the real module does not have", () => {
    expect(withOverrides({ a: 1 }, { c: "synthetic" })).toEqual({ a: 1, c: "synthetic" });
  });
});

// Top level, as the helper asks; the real module is put back after this file.
await mockModuleForFile("@/infrastructure/vault-gate", {
  LOCKED_MESSAGE: "Synthetic locked message.",
});

describe("mockModuleForFile", () => {
  test("replaces the named export and keeps the other real ones", async () => {
    const gate = await import("@/infrastructure/vault-gate");
    expect(gate.LOCKED_MESSAGE).toBe("Synthetic locked message.");
    expect(gate.VAULT_COOKIE).toBe("twinllm_unlock");
    expect(gate.PERSONAL_DATA_LOCKED).toBe("PERSONAL_DATA_LOCKED");
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const originalEnv = { ...process.env };

beforeAll(async () => {
  Object.assign(process.env, {
    LOCAL_MVP: "true",
    AUTH_DISABLED: "true",
    LLM_PROVIDER: "ollama",
    DATA_MODE: "personal",
    DATABASE_URL: "postgresql://synthetic@localhost:1/none",
  });
  const { resetServerEnvCacheForTests } = await import("./env");
  resetServerEnvCacheForTests();
});

afterAll(async () => {
  const { vaultSessions } = await import("./vault-session");
  vaultSessions().lock("actor-runtime-test");
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, originalEnv);
  const { resetServerEnvCacheForTests } = await import("./env");
  resetServerEnvCacheForTests();
});

describe("the cipher a store gets (#141)", () => {
  test("personal mode: none while locked, the session's keys once unlocked", async () => {
    const { cipherForActor, PersonalDataLockedError } =
      await import("./field-cipher-runtime");
    const { vaultSessions } = await import("./vault-session");
    expect(() => cipherForActor("actor-runtime-test")).toThrow(PersonalDataLockedError);
    vaultSessions().open(
      "actor-runtime-test",
      "0123456789abcdef",
      Buffer.alloc(32, 6),
      "t",
    );
    const cipher = cipherForActor("actor-runtime-test");
    expect(cipher.mode).toBe("sealed");
    expect(cipher.activeKeyId).toBe("0123456789abcdef");
    vaultSessions().lock("actor-runtime-test");
    expect(() => cipherForActor("actor-runtime-test")).toThrow(PersonalDataLockedError);
  });

  test("synthetic mode: the plain cipher, no vault", async () => {
    Object.assign(process.env, { DATA_MODE: "synthetic" });
    const { resetServerEnvCacheForTests } = await import("./env");
    resetServerEnvCacheForTests();
    const { cipherForActor } = await import("./field-cipher-runtime");
    expect(cipherForActor("actor-runtime-test").mode).toBe("plain");
  });
});

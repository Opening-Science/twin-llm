import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";

import { anchorEnv, parseServerEnv, storageEnv, vaultEnv } from "./env";

const BASE = {
  LOCAL_MVP: "true",
  AUTH_DISABLED: "true",
  LLM_PROVIDER: "ollama",
  DATABASE_URL: "postgresql://synthetic@localhost:1/none",
} as const;

describe("storage settings (#144)", () => {
  test("TWINLLM_STATE_DIR must be absolute", () => {
    expect(() => parseServerEnv({ ...BASE, TWINLLM_STATE_DIR: "state" })).toThrow(
      "TWINLLM_STATE_DIR must be an absolute path",
    );
    expect(parseServerEnv({ ...BASE, TWINLLM_STATE_DIR: "" }).TWINLLM_STATE_DIR).toBe(
      undefined,
    );
  });

  test("storageEnv uses the set folders", () => {
    const env = parseServerEnv({
      ...BASE,
      DATA_MODE: "synthetic",
      TWINLLM_STATE_DIR: "/srv/twin-llm-state",
      VITRONIC_DATA_DIR: "scans",
    });
    expect(storageEnv(env, "/work/twin-llm")).toEqual({
      dataMode: "synthetic",
      stateDir: "/srv/twin-llm-state",
      vitronicDir: "/work/twin-llm/scans",
      databaseUrl: BASE.DATABASE_URL,
    });
  });

  test("defaults: the platform state folder and data/vitronic", () => {
    const env = parseServerEnv({ ...BASE, XDG_DATA_HOME: "/xdg" });
    const storage = storageEnv(env, "/work/twin-llm");
    expect(storage.dataMode).toBe("personal");
    expect(storage.vitronicDir).toBe("/work/twin-llm/data/vitronic");
    expect(storage.stateDir).toBe(
      process.platform === "darwin"
        ? `${homedir()}/Library/Application Support/TwinLLM`
        : "/xdg/twin-llm",
    );
  });
});

describe("unlock settings (#142)", () => {
  test("idle lock: 15 minutes by default, 1 to 240 allowed", () => {
    const env = parseServerEnv({ ...BASE, TWINLLM_STATE_DIR: "/srv/twin-llm-state" });
    expect(vaultEnv(env)).toEqual({
      dataMode: "personal",
      stateDir: "/srv/twin-llm-state",
      idleLockMs: 15 * 60_000,
    });
    expect(
      vaultEnv(parseServerEnv({ ...BASE, VAULT_IDLE_LOCK_MINUTES: "240" })).idleLockMs,
    ).toBe(240 * 60_000);
    expect(() => parseServerEnv({ ...BASE, VAULT_IDLE_LOCK_MINUTES: "0" })).toThrow(
      "VAULT_IDLE_LOCK_MINUTES must be at least 1",
    );
    expect(() => parseServerEnv({ ...BASE, VAULT_IDLE_LOCK_MINUTES: "241" })).toThrow(
      "VAULT_IDLE_LOCK_MINUTES must be at most 240",
    );
  });
});

describe("anchor settings (#300)", () => {
  test("every 10 minutes by default, 1 to 1440 allowed", () => {
    const env = parseServerEnv({ ...BASE, TWINLLM_STATE_DIR: "/srv/twin-llm-state" });
    expect(anchorEnv(env)).toEqual({
      stateDir: "/srv/twin-llm-state",
      intervalMs: 10 * 60_000,
    });
    expect(
      anchorEnv(parseServerEnv({ ...BASE, AUDIT_ANCHOR_INTERVAL_MINUTES: "15" }))
        .intervalMs,
    ).toBe(15 * 60_000);
    expect(() => parseServerEnv({ ...BASE, AUDIT_ANCHOR_INTERVAL_MINUTES: "0" })).toThrow(
      "AUDIT_ANCHOR_INTERVAL_MINUTES must be at least 1",
    );
    expect(() =>
      parseServerEnv({ ...BASE, AUDIT_ANCHOR_INTERVAL_MINUTES: "1441" }),
    ).toThrow("AUDIT_ANCHOR_INTERVAL_MINUTES must be at most 1440");
  });
});

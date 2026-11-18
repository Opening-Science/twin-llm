import { describe, expect, test } from "bun:test";

import { parseServerEnv, voiceEnv } from "./env";

const BASE = {
  NODE_ENV: "test",
  LOCAL_ONLY: "true",
  LOCAL_MVP: "true",
  AUTH_DISABLED: "true",
  DATA_MODE: "personal",
  DATABASE_URL: "postgresql://synthetic@localhost:1/none",
} as const;

const parseError = (source: NodeJS.ProcessEnv): string => {
  try {
    parseServerEnv(source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected parseServerEnv to throw");
};

describe("voice env", () => {
  test("voice is off until the sidecar is named", () => {
    expect(voiceEnv(parseServerEnv(BASE))).toEqual({
      sidecarUrl: null,
      timeoutMs: 30_000,
    });
  });

  test("reads a sidecar on loopback and its time limit", () => {
    const env = parseServerEnv({
      ...BASE,
      VOICE_SIDECAR_URL: "http://127.0.0.1:8095",
      VOICE_SIDECAR_TIMEOUT_S: "12",
    });
    expect(voiceEnv(env)).toEqual({
      sidecarUrl: "http://127.0.0.1:8095",
      timeoutMs: 12_000,
    });
  });

  test("a sidecar off this machine stops the boot", () => {
    expect(
      parseError({ ...BASE, VOICE_SIDECAR_URL: "https://speech.example.org" }),
    ).toContain("VOICE_SIDECAR_URL: VOICE_SIDECAR_URL must be on this machine");
  });

  test("a time limit that is not a whole positive number stops the boot", () => {
    expect(parseError({ ...BASE, VOICE_SIDECAR_TIMEOUT_S: "0" })).toContain(
      "VOICE_SIDECAR_TIMEOUT_S must be above 0",
    );
  });
});

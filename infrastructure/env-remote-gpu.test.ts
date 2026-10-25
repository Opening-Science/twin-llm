import { describe, expect, test } from "bun:test";

import { parseServerEnv } from "./env";

const BASE = {
  LOCAL_MVP: "true",
  AUTH_DISABLED: "true",
  LOCAL_ONLY: "false",
  DATA_MODE: "synthetic",
  LLM_PROVIDER: "remote-gpu",
  DATABASE_URL: "postgresql://synthetic@localhost:1/none",
  REMOTE_GPU_BASE_URLS: "http://127.0.0.1:8000/v1, http://localhost:8002/v1/",
} as const;

const parseError = (source: NodeJS.ProcessEnv): string => {
  try {
    parseServerEnv(source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected parseServerEnv to throw");
};

describe("LLM_PROVIDER=remote-gpu env", () => {
  test("parses a comma list of tunnel URLs in order, trimmed", () => {
    const env = parseServerEnv({ ...BASE, REMOTE_GPU_API_KEY: "synthetic-vllm-key" });
    expect(env.LLM_PROVIDER).toBe("remote-gpu");
    expect(env.REMOTE_GPU_BASE_URLS).toEqual([
      "http://127.0.0.1:8000/v1",
      "http://localhost:8002/v1/",
    ]);
    expect(env.REMOTE_GPU_API_KEY).toBe("synthetic-vllm-key");
  });

  test("an unset list parses to an empty array for other providers", () => {
    const env = parseServerEnv({
      ...BASE,
      LLM_PROVIDER: "ollama",
      REMOTE_GPU_BASE_URLS: "",
    });
    expect(env.REMOTE_GPU_BASE_URLS).toEqual([]);
    expect(env.REMOTE_GPU_API_KEY).toBeUndefined();
  });

  test("needs at least one URL", () => {
    expect(parseError({ ...BASE, REMOTE_GPU_BASE_URLS: " , " })).toContain(
      "  - REMOTE_GPU_BASE_URLS: REMOTE_GPU_BASE_URLS is required when LLM_PROVIDER=remote-gpu (comma list such as http://127.0.0.1:8000/v1)",
    );
  });

  test("refuses a URL off this machine and names it by position, not value", () => {
    const message = parseError({
      ...BASE,
      REMOTE_GPU_BASE_URLS:
        "http://127.0.0.1:8000/v1,http://user:secret@203.0.113.7:8002/v1",
    });
    expect(message).toContain(
      "  - REMOTE_GPU_BASE_URLS: REMOTE_GPU_BASE_URLS entry 2 must be an SSH tunnel on this machine (localhost, 127.0.0.1 or [::1])",
    );
    expect(message).not.toContain("secret");
    expect(message).not.toContain("203.0.113.7");
  });

  test("refuses a loopback URL that does not end in /v1", () => {
    expect(
      parseError({ ...BASE, REMOTE_GPU_BASE_URLS: "http://127.0.0.1:8000" }),
    ).toContain("  - REMOTE_GPU_BASE_URLS: REMOTE_GPU_BASE_URLS entry 1 must end in /v1");
  });

  test("refuses a loopback URL with a username or password, without echoing it", () => {
    const message = parseError({
      ...BASE,
      REMOTE_GPU_BASE_URLS:
        "http://127.0.0.1:8000/v1,http://synthetic:secret@127.0.0.1:8002/v1",
    });
    expect(message).toContain(
      "  - REMOTE_GPU_BASE_URLS: REMOTE_GPU_BASE_URLS entry 2 must not contain a username or password",
    );
    expect(message).not.toContain("secret");
  });

  test("refuses a loopback URL with a query or hash", () => {
    expect(
      parseError({ ...BASE, REMOTE_GPU_BASE_URLS: "http://127.0.0.1:8000/v1?key=x" }),
    ).toContain(
      "  - REMOTE_GPU_BASE_URLS: REMOTE_GPU_BASE_URLS entry 1 must not contain a query or hash",
    );
    expect(
      parseError({ ...BASE, REMOTE_GPU_BASE_URLS: "http://127.0.0.1:8000/v1#x" }),
    ).toContain(
      "  - REMOTE_GPU_BASE_URLS: REMOTE_GPU_BASE_URLS entry 1 must not contain a query or hash",
    );
  });

  test("refuses a loopback URL that is not http or https", () => {
    expect(
      parseError({ ...BASE, REMOTE_GPU_BASE_URLS: "ftp://127.0.0.1:8000/v1" }),
    ).toContain(
      "  - REMOTE_GPU_BASE_URLS: REMOTE_GPU_BASE_URLS entry 1 must start with http:// or https://",
    );
  });

  test("DATA_MODE=personal fails startup", () => {
    expect(parseError({ ...BASE, DATA_MODE: "personal" })).toContain(
      "  - LLM_PROVIDER: DATA_MODE=personal forbids LLM_PROVIDER=remote-gpu; the remote GPU is for synthetic data only",
    );
  });

  test("the default DATA_MODE (personal) fails startup too", () => {
    expect(parseError({ ...BASE, DATA_MODE: undefined })).toContain(
      "  - LLM_PROVIDER: DATA_MODE=personal forbids LLM_PROVIDER=remote-gpu; the remote GPU is for synthetic data only",
    );
  });

  test("LOCAL_ONLY=true fails startup even though the tunnel is on loopback", () => {
    expect(parseError({ ...BASE, LOCAL_ONLY: "true" })).toContain(
      "  - LLM_PROVIDER: LOCAL_ONLY=true needs LLM_PROVIDER=ollama; remote-gpu runs the model on another machine even though its tunnel is on 127.0.0.1. Set LOCAL_ONLY=false",
    );
  });
});

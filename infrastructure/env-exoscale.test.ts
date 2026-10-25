import { describe, expect, test } from "bun:test";

import { parseServerEnv } from "./env";

const BASE = {
  LOCAL_MVP: "true",
  AUTH_DISABLED: "true",
  LOCAL_ONLY: "false",
  DATA_MODE: "personal",
  LLM_PROVIDER: "exoscale",
  DATABASE_URL: "postgresql://synthetic@localhost:1/none",
  EXOSCALE_BASE_URLS: "https://gpu1.example.invalid/v1, https://gpu2.example.invalid/v1/",
} as const;

const parseError = (source: NodeJS.ProcessEnv): string => {
  try {
    parseServerEnv(source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected parseServerEnv to throw");
};

describe("LLM_PROVIDER=exoscale env", () => {
  test("parses one URL per GPU in order, trimmed, with the key and the 120 s default", () => {
    const env = parseServerEnv({ ...BASE, EXOSCALE_API_KEY: "synthetic-vllm-key" });
    expect(env.LLM_PROVIDER).toBe("exoscale");
    expect(env.EXOSCALE_BASE_URLS).toEqual([
      "https://gpu1.example.invalid/v1",
      "https://gpu2.example.invalid/v1/",
    ]);
    expect(env.EXOSCALE_API_KEY).toBe("synthetic-vllm-key");
    expect(env.EXOSCALE_FIRST_BYTE_TIMEOUT_S).toBe(120);
  });

  test("an empty key and an empty timeout fall back to none and 120", () => {
    const env = parseServerEnv({
      ...BASE,
      EXOSCALE_API_KEY: "",
      EXOSCALE_FIRST_BYTE_TIMEOUT_S: "",
    });
    expect(env.EXOSCALE_API_KEY).toBeUndefined();
    expect(env.EXOSCALE_FIRST_BYTE_TIMEOUT_S).toBe(120);
  });

  test("takes a first-byte timeout in whole seconds", () => {
    expect(
      parseServerEnv({ ...BASE, EXOSCALE_FIRST_BYTE_TIMEOUT_S: "300" })
        .EXOSCALE_FIRST_BYTE_TIMEOUT_S,
    ).toBe(300);
    expect(parseError({ ...BASE, EXOSCALE_FIRST_BYTE_TIMEOUT_S: "0" })).toContain(
      "  - EXOSCALE_FIRST_BYTE_TIMEOUT_S: EXOSCALE_FIRST_BYTE_TIMEOUT_S must be above 0",
    );
    expect(parseError({ ...BASE, EXOSCALE_FIRST_BYTE_TIMEOUT_S: "1.5" })).toContain(
      "  - EXOSCALE_FIRST_BYTE_TIMEOUT_S: EXOSCALE_FIRST_BYTE_TIMEOUT_S must be a whole number of seconds",
    );
  });

  test("needs at least one URL", () => {
    expect(parseError({ ...BASE, EXOSCALE_BASE_URLS: " , " })).toContain(
      "  - EXOSCALE_BASE_URLS: EXOSCALE_BASE_URLS is required when LLM_PROVIDER=exoscale, the default with LOCAL_ONLY=false (comma list of vLLM URLs ending in /v1, one per GPU). For a model on this machine set LOCAL_ONLY=true",
    );
  });

  test("DATA_MODE=personal is allowed: the instance is our own", () => {
    expect(parseServerEnv(BASE).DATA_MODE).toBe("personal");
    expect(parseServerEnv({ ...BASE, DATA_MODE: undefined }).DATA_MODE).toBe("personal");
    expect(parseServerEnv({ ...BASE, DATA_MODE: "synthetic" }).DATA_MODE).toBe(
      "synthetic",
    );
  });

  test("refuses plain http off this machine, naming the entry by position", () => {
    const message = parseError({
      ...BASE,
      EXOSCALE_BASE_URLS: "https://gpu1.example.invalid/v1,http://203.0.113.7:8000/v1",
    });
    expect(message).toContain(
      "  - EXOSCALE_BASE_URLS: EXOSCALE_BASE_URLS entry 2 must start with https:// (plain http only on loopback with EXOSCALE_ALLOW_LOOPBACK_TUNNEL=true)",
    );
    expect(message).not.toContain("203.0.113.7");
  });

  test("refuses plain http on loopback unless the tunnel opt-in is set", () => {
    for (const url of ["http://127.0.0.1:9000/v1", "http://[::1]:9000/v1"]) {
      expect(parseError({ ...BASE, EXOSCALE_BASE_URLS: url })).toContain(
        "  - EXOSCALE_BASE_URLS: EXOSCALE_BASE_URLS entry 1 is plain http on loopback; set EXOSCALE_ALLOW_LOOPBACK_TUNNEL=true only for an SSH tunnel to our own Exoscale VM",
      );
    }
    expect(
      parseError({
        ...BASE,
        EXOSCALE_ALLOW_LOOPBACK_TUNNEL: "false",
        EXOSCALE_BASE_URLS: "http://localhost:9000/v1",
      }),
    ).toContain(
      "  - EXOSCALE_BASE_URLS: EXOSCALE_BASE_URLS entry 1 is plain http on loopback; set EXOSCALE_ALLOW_LOOPBACK_TUNNEL=true only for an SSH tunnel to our own Exoscale VM",
    );
  });

  test("allows plain http on loopback with the tunnel opt-in", () => {
    const env = parseServerEnv({
      ...BASE,
      EXOSCALE_ALLOW_LOOPBACK_TUNNEL: "true",
      EXOSCALE_BASE_URLS:
        "http://127.0.0.1:9000/v1,http://localhost:9001/v1,http://[::1]:9002/v1",
    });
    expect(env.EXOSCALE_ALLOW_LOOPBACK_TUNNEL).toBe(true);
    expect(env.EXOSCALE_BASE_URLS).toEqual([
      "http://127.0.0.1:9000/v1",
      "http://localhost:9001/v1",
      "http://[::1]:9002/v1",
    ]);
  });

  test("the opt-in is off by default", () => {
    expect(parseServerEnv(BASE).EXOSCALE_ALLOW_LOOPBACK_TUNNEL).toBe(false);
    expect(
      parseServerEnv({ ...BASE, EXOSCALE_ALLOW_LOOPBACK_TUNNEL: "" })
        .EXOSCALE_ALLOW_LOOPBACK_TUNNEL,
    ).toBe(false);
  });

  test("a host that only starts with localhost is not loopback, even with the opt-in", () => {
    const message = parseError({
      ...BASE,
      EXOSCALE_ALLOW_LOOPBACK_TUNNEL: "true",
      EXOSCALE_BASE_URLS: "http://localhost.evil.com:9000/v1",
    });
    expect(message).toContain(
      `  - EXOSCALE_BASE_URLS: EXOSCALE_BASE_URLS entry 1 ${"must start with https:// (plain http only on loopback with EXOSCALE_ALLOW_LOOPBACK_TUNNEL=true)"}`,
    );
    expect(message).not.toContain("evil");
  });

  test("uppercase HTTPS and a trailing slash after /v1 are accepted", () => {
    expect(
      parseServerEnv({
        ...BASE,
        EXOSCALE_BASE_URLS:
          "HTTPS://gpu1.example.invalid/v1,https://gpu2.example.invalid/v1/",
      }).EXOSCALE_BASE_URLS,
    ).toEqual(["HTTPS://gpu1.example.invalid/v1", "https://gpu2.example.invalid/v1/"]);
  });

  test("refuses an entry that is also a remote-gpu tunnel, ignoring case and trailing slashes", () => {
    const message = parseError({
      ...BASE,
      EXOSCALE_ALLOW_LOOPBACK_TUNNEL: "true",
      REMOTE_GPU_BASE_URLS: "http://127.0.0.1:8000/v1/",
      EXOSCALE_BASE_URLS:
        "https://gpu1.example.invalid/v1,HTTP://LOCALHOST:8001/v1,HTTP://127.0.0.1:8000/v1",
    });
    expect(message).toContain(
      "  - EXOSCALE_BASE_URLS: EXOSCALE_BASE_URLS entry 3 is also in REMOTE_GPU_BASE_URLS; a remote-gpu tunnel must never carry exoscale traffic",
    );
    expect(message).not.toContain("entry 1");
    expect(message).not.toContain("entry 2");
  });

  test("refuses a username or password without echoing it", () => {
    const message = parseError({
      ...BASE,
      EXOSCALE_BASE_URLS: "https://synthetic:secret@gpu1.example.invalid/v1",
    });
    expect(message).toContain(
      "  - EXOSCALE_BASE_URLS: EXOSCALE_BASE_URLS entry 1 must not contain a username or password",
    );
    expect(message).not.toContain("secret");
  });

  test("refuses a query or hash", () => {
    expect(
      parseError({
        ...BASE,
        EXOSCALE_BASE_URLS: "https://gpu1.example.invalid/v1?key=x",
      }),
    ).toContain(
      "  - EXOSCALE_BASE_URLS: EXOSCALE_BASE_URLS entry 1 must not contain a query or hash",
    );
    expect(
      parseError({ ...BASE, EXOSCALE_BASE_URLS: "https://gpu1.example.invalid/v1#x" }),
    ).toContain(
      "  - EXOSCALE_BASE_URLS: EXOSCALE_BASE_URLS entry 1 must not contain a query or hash",
    );
  });

  test("refuses a URL that does not end in /v1, or is not a URL", () => {
    expect(
      parseError({ ...BASE, EXOSCALE_BASE_URLS: "https://gpu1.example.invalid" }),
    ).toContain("  - EXOSCALE_BASE_URLS: EXOSCALE_BASE_URLS entry 1 must end in /v1");
    expect(parseError({ ...BASE, EXOSCALE_BASE_URLS: "gpu1/v1" })).toContain(
      "  - EXOSCALE_BASE_URLS: EXOSCALE_BASE_URLS entry 1 is not a URL",
    );
  });

  test("checks the URLs even when another provider is active", () => {
    expect(
      parseError({ ...BASE, LLM_PROVIDER: "ollama", EXOSCALE_BASE_URLS: "ftp://x/v1" }),
    ).toContain(
      "  - EXOSCALE_BASE_URLS: EXOSCALE_BASE_URLS entry 1 must start with https:// (plain http only on loopback with EXOSCALE_ALLOW_LOOPBACK_TUNNEL=true)",
    );
  });

  test("infomaniak still parses when named, as a legacy option", () => {
    const env = parseServerEnv({
      ...BASE,
      LLM_PROVIDER: "infomaniak",
      EXOSCALE_BASE_URLS: undefined,
    });
    expect(env.LLM_PROVIDER).toBe("infomaniak");
    expect(env.EXOSCALE_BASE_URLS).toEqual([]);
  });
});

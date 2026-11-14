import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { asFetch } from "./as-fetch";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
let fetchCalls = 0;

beforeEach(async () => {
  fetchCalls = 0;
  Object.assign(process.env, {
    LOCAL_MVP: "true",
    AUTH_DISABLED: "true",
    LLM_PROVIDER: "infomaniak",
    DATA_MODE: "synthetic",
    DATABASE_URL: "postgresql://synthetic@localhost:1/none",
    INFOMANIAK_API_TOKEN: "synthetic-infomaniak-token",
    INFOMANIAK_PRODUCT_ID: "synthetic-product",
  });
  const { resetServerEnvCacheForTests } = await import("./env");
  const { resetInfomaniakCatalogCacheForTests } = await import("./fetch-model-catalog");
  resetServerEnvCacheForTests();
  resetInfomaniakCatalogCacheForTests();
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, originalEnv);
  const { resetServerEnvCacheForTests } = await import("./env");
  const { resetInfomaniakCatalogCacheForTests } = await import("./fetch-model-catalog");
  resetServerEnvCacheForTests();
  resetInfomaniakCatalogCacheForTests();
});

describe("Infomaniak allowlist", () => {
  test("200 with two ids uses the live list and caches", async () => {
    globalThis.fetch = asFetch(async (input: RequestInfo | URL) => {
      fetchCalls += 1;
      const url = input instanceof URL ? input.href : String(input);
      expect(url).toBe(
        "https://api.infomaniak.com/2/ai/synthetic-product/openai/v1/models",
      );
      return new Response(JSON.stringify({ data: [{ id: "qwen3" }, { id: "llama3" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }, originalFetch);

    const { fetchActiveModelCatalog, isFallbackCatalog } =
      await import("./fetch-model-catalog");
    const first = await fetchActiveModelCatalog();
    const second = await fetchActiveModelCatalog();

    expect(first?.map((m) => m.id)).toEqual(["qwen3", "llama3"]);
    expect(first === null ? null : isFallbackCatalog(first)).toBe(false);
    expect(second?.map((m) => m.id)).toEqual(["qwen3", "llama3"]);
    expect(fetchCalls).toBe(1);
  });

  test("500 falls back to the static triple", async () => {
    const warnings: unknown[][] = [];
    const warnSpy = spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });
    try {
      globalThis.fetch = asFetch(async () => {
        fetchCalls += 1;
        return new Response("sk-test-123 Bearer abc Tell me about my recovery.", {
          status: 500,
        });
      }, originalFetch);

      const { fetchActiveModelCatalog, isFallbackCatalog } =
        await import("./fetch-model-catalog");
      const catalog = await fetchActiveModelCatalog();

      expect(catalog?.map((m) => m.id)).toEqual(["llama3", "mixtral", "qwen3"]);
      expect(catalog === null ? null : isFallbackCatalog(catalog)).toBe(true);
      expect(fetchCalls).toBe(1);
      expect(warnings).toEqual([
        ["[model-catalog] infomaniak allowlist source=static", 500],
      ]);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("Ollama fallback", () => {
  test("an unreachable daemon gives the built-in list, marked as the fallback", async () => {
    Object.assign(process.env, { LLM_PROVIDER: "ollama" });
    const { resetServerEnvCacheForTests } = await import("./env");
    resetServerEnvCacheForTests();
    globalThis.fetch = asFetch(async () => {
      fetchCalls += 1;
      throw new TypeError("fetch failed");
    }, originalFetch);

    const { fetchActiveModelCatalog, isFallbackCatalog } =
      await import("./fetch-model-catalog");
    const catalog = await fetchActiveModelCatalog();

    expect(catalog?.map((m) => m.id)).toEqual(["llama3.2", "mistral"]);
    expect(catalog === null ? null : isFallbackCatalog(catalog)).toBe(true);
    expect(fetchCalls).toBe(1);
  });

  test("a listed daemon is not the fallback", async () => {
    Object.assign(process.env, { LLM_PROVIDER: "ollama" });
    const { resetServerEnvCacheForTests } = await import("./env");
    resetServerEnvCacheForTests();
    globalThis.fetch = asFetch(
      async () =>
        new Response(
          JSON.stringify({
            models: [{ name: "qwen3:4b", capabilities: ["completion"] }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      originalFetch,
    );

    const { fetchActiveModelCatalog, isFallbackCatalog } =
      await import("./fetch-model-catalog");
    const catalog = await fetchActiveModelCatalog();

    expect(catalog?.map((m) => m.id)).toEqual(["qwen3:4b"]);
    expect(catalog === null ? null : isFallbackCatalog(catalog)).toBe(false);
  });
});

import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  permitProviderForRequest,
  PROVIDER_NOT_PERMITTED_ERROR,
  PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
  type DataMode,
  type LlmProvider,
} from "@/infrastructure/data-mode-policy";

mock.module("server-only", () => ({}));

const originalEnv = { ...process.env };

const applyEnv = async (values: {
  readonly DATA_MODE: string;
  readonly LLM_PROVIDER: string;
  readonly OPENROUTER_API_KEY?: string;
  readonly INFOMANIAK_API_TOKEN?: string;
  readonly INFOMANIAK_PRODUCT_ID?: string;
  readonly REMOTE_GPU_BASE_URLS?: string;
  readonly EXOSCALE_BASE_URLS?: string;
  readonly EXOSCALE_PERSONAL_DATA?: string;
}) => {
  Object.assign(process.env, {
    LOCAL_MVP: "true",
    AUTH_DISABLED: "true",
    DATABASE_URL: "postgresql://synthetic@localhost:1/none",
    OPENROUTER_API_KEY: values.OPENROUTER_API_KEY ?? "synthetic-openrouter-key",
    INFOMANIAK_API_TOKEN: values.INFOMANIAK_API_TOKEN ?? "synthetic-infomaniak-token",
    INFOMANIAK_PRODUCT_ID: values.INFOMANIAK_PRODUCT_ID ?? "synthetic-product",
    DATA_MODE: values.DATA_MODE,
    LLM_PROVIDER: values.LLM_PROVIDER,
    ...(values.REMOTE_GPU_BASE_URLS
      ? { LOCAL_ONLY: "false", REMOTE_GPU_BASE_URLS: values.REMOTE_GPU_BASE_URLS }
      : {}),
    ...(values.EXOSCALE_BASE_URLS
      ? { LOCAL_ONLY: "false", EXOSCALE_BASE_URLS: values.EXOSCALE_BASE_URLS }
      : {}),
    EXOSCALE_PERSONAL_DATA: values.EXOSCALE_PERSONAL_DATA ?? "off",
  });
  const { resetServerEnvCacheForTests } = await import("@/infrastructure/env");
  resetServerEnvCacheForTests();
};

afterEach(async () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, originalEnv);
  const { resetServerEnvCacheForTests } = await import("@/infrastructure/env");
  resetServerEnvCacheForTests();
});

const COMBOS = [
  {
    id: "synthetic, no narrative, openrouter",
    mode: "synthetic" as DataMode,
    provider: "openrouter" as LlmProvider,
    hasWearableNarrative: false,
    allow: true,
  },
  {
    id: "synthetic, narrative, openrouter",
    mode: "synthetic" as DataMode,
    provider: "openrouter" as LlmProvider,
    hasWearableNarrative: true,
    allow: false,
  },
  {
    id: "personal, no narrative, openrouter",
    mode: "personal" as DataMode,
    provider: "openrouter" as LlmProvider,
    hasWearableNarrative: false,
    allow: false,
  },
  {
    id: "personal, narrative, openrouter",
    mode: "personal" as DataMode,
    provider: "openrouter" as LlmProvider,
    hasWearableNarrative: true,
    allow: false,
  },
] as const;

describe("resolveLanguageModel DATA_MODE permit", () => {
  test("openrouter with hasWearableNarrative=true throws the rule sentence only", async () => {
    await applyEnv({ DATA_MODE: "synthetic", LLM_PROVIDER: "openrouter" });
    const { ProviderNotPermittedError, resolveLanguageModel } =
      await import("./resolve-language-model");

    expect(() =>
      resolveLanguageModel("synthetic-model", { hasWearableNarrative: true }),
    ).toThrow(ProviderNotPermittedError);

    try {
      resolveLanguageModel("synthetic-model", { hasWearableNarrative: true });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderNotPermittedError);
      expect((error as Error).message).toBe(PROVIDER_NOT_PERMITTED_ERROR);
      expect((error as { code: string }).code).toBe(PROVIDER_NOT_PERMITTED_FOR_DATA_MODE);
      expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toMatch(
        /Oura|Whoop|recovery|score|narrative/i,
      );
    }
  });

  test("infomaniak with hasWearableNarrative=true does not throw", async () => {
    await applyEnv({ DATA_MODE: "personal", LLM_PROVIDER: "infomaniak" });
    const { resolveLanguageModel } = await import("./resolve-language-model");
    const model = resolveLanguageModel("synthetic-model", {
      hasWearableNarrative: true,
    });
    expect(model).toBeDefined();
  });

  for (const combo of COMBOS) {
    test(`${combo.id}: route permit and resolver agree`, async () => {
      const permit = permitProviderForRequest({
        mode: combo.mode,
        provider: combo.provider,
        hasWearableNarrative: combo.hasWearableNarrative,
        exoscalePersonalData: "off",
      });

      if (combo.allow) {
        expect(permit).toEqual({ ok: true });
      } else {
        expect(permit).toEqual({
          ok: false,
          code: PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
          error: PROVIDER_NOT_PERMITTED_ERROR,
        });
      }

      const envParses = !(combo.mode === "personal" && combo.provider === "openrouter");
      if (!envParses) {
        await applyEnv({ DATA_MODE: combo.mode, LLM_PROVIDER: combo.provider });
        const { serverEnv } = await import("@/infrastructure/env");
        expect(() => serverEnv()).toThrow(/openrouter/i);
        expect(permit.ok).toBe(false);
        return;
      }

      await applyEnv({ DATA_MODE: combo.mode, LLM_PROVIDER: combo.provider });
      const { ProviderNotPermittedError, resolveLanguageModel } =
        await import("./resolve-language-model");

      if (combo.allow) {
        expect(() =>
          resolveLanguageModel("synthetic-model", {
            hasWearableNarrative: combo.hasWearableNarrative,
          }),
        ).not.toThrow();
        return;
      }

      try {
        resolveLanguageModel("synthetic-model", {
          hasWearableNarrative: combo.hasWearableNarrative,
        });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderNotPermittedError);
        expect((error as Error).message).toBe(permit.error);
        expect((error as { code: string }).code).toBe(permit.code);
      }
    });
  }
});

describe("remote-gpu routing", () => {
  const ROUTES = new Map([
    ["onprem-ai/Apertus-v1.5-70B-FP8", "http://127.0.0.1:8000/v1"],
    ["apertus-70b-fp8", "http://127.0.0.1:8002/v1"],
  ]);
  const baseUrlFor = (modelId: string) => ROUTES.get(modelId) ?? null;

  test("each id goes to the tunnel URL that listed it, with the vLLM key", async () => {
    const { remoteGpuTarget } = await import("./resolve-language-model");
    expect(
      remoteGpuTarget("apertus-70b-fp8", { baseUrlFor, apiKey: "synthetic-vllm-key" }),
    ).toEqual({ baseURL: "http://127.0.0.1:8002/v1", apiKey: "synthetic-vllm-key" });
    expect(
      remoteGpuTarget("onprem-ai/Apertus-v1.5-70B-FP8", { baseUrlFor, apiKey: null }),
    ).toEqual({ baseURL: "http://127.0.0.1:8000/v1", apiKey: "remote-gpu" });
  });

  test("an id no tunnel listed throws a plain error, never a guess", async () => {
    const { REMOTE_GPU_MODEL_NOT_LISTED, remoteGpuTarget } =
      await import("./resolve-language-model");
    expect(REMOTE_GPU_MODEL_NOT_LISTED).toBe(
      "REMOTE_GPU_MODEL_NOT_LISTED: no remote GPU tunnel lists this model; reload the model list",
    );
    expect(() =>
      remoteGpuTarget("swiss-ai/Apertus-v1.5-8B", { baseUrlFor, apiKey: null }),
    ).toThrow(REMOTE_GPU_MODEL_NOT_LISTED);
  });

  test("resolveLanguageModel refuses remote-gpu when wearable context is attached", async () => {
    await applyEnv({
      DATA_MODE: "synthetic",
      LLM_PROVIDER: "remote-gpu",
      REMOTE_GPU_BASE_URLS: "http://127.0.0.1:8000/v1",
    });
    const { ProviderNotPermittedError, resolveLanguageModel } =
      await import("./resolve-language-model");
    try {
      resolveLanguageModel("apertus-70b-fp8", { hasWearableNarrative: true });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderNotPermittedError);
      expect((error as Error).message).toBe(PROVIDER_NOT_PERMITTED_ERROR);
      expect((error as { code: string }).code).toBe(PROVIDER_NOT_PERMITTED_FOR_DATA_MODE);
    }
  });

  test("resolveLanguageModel refuses a model before any catalog listed it", async () => {
    await applyEnv({
      DATA_MODE: "synthetic",
      LLM_PROVIDER: "remote-gpu",
      REMOTE_GPU_BASE_URLS: "http://127.0.0.1:8000/v1",
    });
    const { REMOTE_GPU_MODEL_NOT_LISTED, resolveLanguageModel } =
      await import("./resolve-language-model");
    expect(() =>
      resolveLanguageModel("apertus-70b-fp8", { hasWearableNarrative: false }),
    ).toThrow(REMOTE_GPU_MODEL_NOT_LISTED);
  });
});

describe("exoscale routing and data policy", () => {
  const GPU_1 = "https://gpu1.example.invalid/v1";
  const GPU_2 = "https://gpu2.example.invalid/v1";
  const ROUTES = new Map([
    ["swiss-ai/Apertus-8B-Instruct-2509", GPU_1],
    ["Qwen/Qwen3-8B", GPU_2],
  ]);
  const baseUrlFor = (modelId: string) => ROUTES.get(modelId) ?? null;
  const noFetch = async (): Promise<Response> => {
    throw new Error("no network in tests");
  };

  test("each id goes to the GPU server that listed it, with the vLLM key", async () => {
    const { exoscaleTarget } = await import("./resolve-language-model");
    const target = exoscaleTarget("Qwen/Qwen3-8B", {
      baseUrlFor,
      apiKey: "synthetic-vllm-key",
      firstByteTimeoutMs: 120_000,
      fetch: noFetch as unknown as typeof fetch,
    });
    expect(target.baseURL).toBe(GPU_2);
    expect(target.apiKey).toBe("synthetic-vllm-key");
    expect(typeof target.fetch).toBe("function");
    expect(
      exoscaleTarget("swiss-ai/Apertus-8B-Instruct-2509", {
        baseUrlFor,
        apiKey: null,
        firstByteTimeoutMs: 120_000,
        fetch: noFetch as unknown as typeof fetch,
      }).apiKey,
    ).toBe("exoscale");
  });

  test("the target's fetch gives up after the first-byte limit", async () => {
    const { exoscaleTarget } = await import("./resolve-language-model");
    const silent = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const target = exoscaleTarget("Qwen/Qwen3-8B", {
      baseUrlFor,
      apiKey: null,
      firstByteTimeoutMs: 20,
      fetch: silent,
    });
    const error = await target.fetch(`${GPU_2}/chat/completions`).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect((error as DOMException).name).toBe("TimeoutError");
  });

  test("an id no server listed throws a plain error, never a guess", async () => {
    const { EXOSCALE_MODEL_NOT_LISTED, exoscaleTarget } =
      await import("./resolve-language-model");
    expect(EXOSCALE_MODEL_NOT_LISTED).toBe(
      "EXOSCALE_MODEL_NOT_LISTED: no Exoscale vLLM server lists this model; reload the model list",
    );
    expect(() =>
      exoscaleTarget("meta-llama/Llama-3.1-8B", {
        baseUrlFor,
        apiKey: null,
        firstByteTimeoutMs: 120_000,
        fetch: noFetch as unknown as typeof fetch,
      }),
    ).toThrow(EXOSCALE_MODEL_NOT_LISTED);
  });

  const EXOSCALE_CASES = [
    // [mode, wearable context, setting, permitted]
    ["synthetic", false, "off", true],
    ["synthetic", false, "consented-pilot", true],
    ["synthetic", true, "off", false],
    ["synthetic", true, "consented-pilot", true],
    ["personal", false, "consented-pilot", true],
    ["personal", true, "consented-pilot", true],
  ] as const;

  for (const [mode, hasWearableNarrative, setting, permitted] of EXOSCALE_CASES) {
    test(`${mode}, narrative ${String(hasWearableNarrative)}, ${setting}: route permit and resolver agree on exoscale`, async () => {
      const permit = permitProviderForRequest({
        mode,
        provider: "exoscale",
        hasWearableNarrative,
        exoscalePersonalData: setting,
      });
      expect(permit).toEqual(
        permitted
          ? { ok: true }
          : {
              ok: false,
              code: PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
              error: PROVIDER_NOT_PERMITTED_ERROR,
            },
      );
      await applyEnv({
        DATA_MODE: mode,
        LLM_PROVIDER: "exoscale",
        EXOSCALE_BASE_URLS: GPU_1,
        EXOSCALE_PERSONAL_DATA: setting,
      });
      const {
        EXOSCALE_MODEL_NOT_LISTED,
        ProviderNotPermittedError,
        resolveLanguageModel,
      } = await import("./resolve-language-model");
      try {
        resolveLanguageModel("swiss-ai/Apertus-8B-Instruct-2509", {
          hasWearableNarrative,
        });
        expect.unreachable();
      } catch (error) {
        if (permitted) {
          // No catalog has listed it in this process, so the permit passed and
          // routing is what refuses.
          expect(error).not.toBeInstanceOf(ProviderNotPermittedError);
          expect((error as Error).message).toBe(EXOSCALE_MODEL_NOT_LISTED);
        } else {
          expect(error).toBeInstanceOf(ProviderNotPermittedError);
          expect((error as Error).message).toBe(PROVIDER_NOT_PERMITTED_ERROR);
        }
      }
    });
  }

  test("personal data with the setting off never reaches the resolver: startup refuses it", async () => {
    await applyEnv({
      DATA_MODE: "personal",
      LLM_PROVIDER: "exoscale",
      EXOSCALE_BASE_URLS: GPU_1,
      EXOSCALE_PERSONAL_DATA: "off",
    });
    const { resolveLanguageModel } = await import("./resolve-language-model");
    expect(() =>
      resolveLanguageModel("swiss-ai/Apertus-8B-Instruct-2509", {
        hasWearableNarrative: false,
      }),
    ).toThrow("EXOSCALE_PERSONAL_DATA=consented-pilot");
  });
});

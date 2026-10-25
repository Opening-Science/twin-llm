import { describe, expect, test } from "bun:test";

import fixture from "./fixtures/vllm-models.json";

import { parseVllmModels, REMOTE_GPU_PROVIDER_LABEL } from "./model-catalog";

describe("parseVllmModels", () => {
  test("maps vLLM /v1/models rows and drops a row without an id", () => {
    expect(parseVllmModels(fixture)).toEqual([
      {
        id: "swiss-ai/Apertus-v1.5-8B",
        name: "swiss-ai/Apertus-v1.5-8B",
        provider: "Remote GPU (SSH tunnel)",
        providerId: "remote-gpu",
        contextTokens: 32768,
      },
      {
        id: "apertus-70b-fp8",
        name: "apertus-70b-fp8",
        provider: "Remote GPU (SSH tunnel)",
        providerId: "remote-gpu",
        contextTokens: 16384,
      },
    ]);
  });

  test("lists the largest context window first, whatever order the server used", () => {
    const models = parseVllmModels({
      data: [
        { id: "synthetic-small", max_model_len: 40960 },
        { id: "synthetic-large", max_model_len: 262_144 },
      ],
    });
    expect(models?.map((model) => model.contextTokens)).toEqual([262_144, 40960]);
  });

  test("the provider label is the one the picker shows", () => {
    expect(REMOTE_GPU_PROVIDER_LABEL).toBe("Remote GPU (SSH tunnel)");
  });

  test("a row without max_model_len falls back to 128K, marked unknown", () => {
    expect(parseVllmModels({ data: [{ id: "synthetic-model" }] })).toEqual([
      {
        id: "synthetic-model",
        name: "synthetic-model",
        provider: "Remote GPU (SSH tunnel)",
        providerId: "remote-gpu",
        contextTokens: 128_000,
        contextUnknown: true,
      },
    ]);
  });

  test("a body that is not a model list is null", () => {
    expect(parseVllmModels({ models: [] })).toBeNull();
    expect(parseVllmModels(null)).toBeNull();
    expect(parseVllmModels("Internal Server Error")).toBeNull();
  });

  test("an empty list is an empty catalog", () => {
    expect(parseVllmModels({ object: "list", data: [] })).toEqual([]);
  });
});

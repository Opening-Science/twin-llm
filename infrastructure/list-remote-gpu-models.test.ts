import { describe, expect, test } from "bun:test";

import { listRemoteGpuModels } from "./list-remote-gpu-models";
import { EXOSCALE_SOURCE } from "./model-catalog";

type Call = { readonly url: string; readonly init: RequestInit };

const PORT_8000 = "http://127.0.0.1:8000/v1";
const PORT_8002 = "http://127.0.0.1:8002/v1";

const modelList = (...rows: readonly { id: string; max_model_len: number }[]) =>
  new Response(JSON.stringify({ object: "list", data: rows }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

/** A fetch that answers per URL and records what it was asked. */
const fakeFetch = (answers: Readonly<Record<string, () => Response>>) => {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const answer = answers[url];
    if (!answer) throw new TypeError("fetch failed");
    return answer();
  };
  return { calls, fetch };
};

describe("listRemoteGpuModels", () => {
  test("merges every tunnel in URL order and routes each id to the URL that listed it", async () => {
    const { calls, fetch } = fakeFetch({
      [`${PORT_8000}/models`]: () =>
        modelList({ id: "onprem-ai/Apertus-v1.5-70B-FP8", max_model_len: 16384 }),
      [`${PORT_8002}/models`]: () =>
        modelList({ id: "apertus-70b-fp8", max_model_len: 16384 }),
    });

    const catalog = await listRemoteGpuModels({
      baseUrls: [PORT_8000, `${PORT_8002}/`],
      apiKey: null,
      fetch,
    });

    expect(catalog.models.map((model) => model.id)).toEqual([
      "onprem-ai/Apertus-v1.5-70B-FP8",
      "apertus-70b-fp8",
    ]);
    expect([...catalog.routes]).toEqual([
      ["onprem-ai/Apertus-v1.5-70B-FP8", PORT_8000],
      ["apertus-70b-fp8", PORT_8002],
    ]);
    expect(catalog.skipped).toEqual([]);
    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:8000/v1/models",
      "http://127.0.0.1:8002/v1/models",
    ]);
  });

  test("sends no Authorization header without a key, and never caches", async () => {
    const { calls, fetch } = fakeFetch({
      [`${PORT_8000}/models`]: () => modelList({ id: "m", max_model_len: 8192 }),
    });
    await listRemoteGpuModels({ baseUrls: [PORT_8000], apiKey: null, fetch });
    expect(calls[0]?.init.headers).toEqual({ Accept: "application/json" });
    expect(calls[0]?.init.cache).toBe("no-store");
  });

  test("sends the vLLM key as a bearer token when one is set", async () => {
    const { calls, fetch } = fakeFetch({
      [`${PORT_8000}/models`]: () => modelList({ id: "m", max_model_len: 8192 }),
    });
    await listRemoteGpuModels({
      baseUrls: [PORT_8000],
      apiKey: "synthetic-vllm-key",
      fetch,
    });
    expect(calls[0]?.init.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer synthetic-vllm-key",
    });
  });

  test("a refused tunnel and a 500 are skipped by host, and the rest still lists", async () => {
    const { fetch } = fakeFetch({
      [`${PORT_8002}/models`]: () =>
        new Response("Bearer synthetic-vllm-key upstream exploded", { status: 500 }),
      "http://127.0.0.1:8004/v1/models": () =>
        modelList({ id: "apertus-70b-fp8", max_model_len: 16384 }),
    });

    const catalog = await listRemoteGpuModels({
      baseUrls: [PORT_8000, PORT_8002, "http://127.0.0.1:8004/v1"],
      apiKey: "synthetic-vllm-key",
      fetch,
    });

    expect(catalog.models.map((model) => model.id)).toEqual(["apertus-70b-fp8"]);
    expect([...catalog.routes]).toEqual([
      ["apertus-70b-fp8", "http://127.0.0.1:8004/v1"],
    ]);
    expect(catalog.skipped).toEqual([
      { host: "127.0.0.1:8000", reason: "unreachable" },
      { host: "127.0.0.1:8002", reason: "status 500" },
    ]);
    expect(JSON.stringify(catalog.skipped)).not.toContain("synthetic-vllm-key");
  });

  test("a body that is not a model list is skipped", async () => {
    const { fetch } = fakeFetch({
      [`${PORT_8000}/models`]: () =>
        new Response("<html>tunnel up, nothing behind it</html>"),
    });
    const catalog = await listRemoteGpuModels({
      baseUrls: [PORT_8000],
      apiKey: null,
      fetch,
    });
    expect(catalog.models).toEqual([]);
    expect(catalog.skipped).toEqual([
      { host: "127.0.0.1:8000", reason: "unexpected body" },
    ]);
  });

  test("the same id on two tunnels goes to the first", async () => {
    const { fetch } = fakeFetch({
      [`${PORT_8000}/models`]: () =>
        modelList({ id: "apertus-70b-fp8", max_model_len: 16384 }),
      [`${PORT_8002}/models`]: () =>
        modelList(
          { id: "apertus-70b-fp8", max_model_len: 8192 },
          { id: "swiss-ai/Apertus-v1.5-8B", max_model_len: 32768 },
        ),
    });

    const catalog = await listRemoteGpuModels({
      baseUrls: [PORT_8000, PORT_8002],
      apiKey: null,
      fetch,
    });

    expect(
      catalog.models.map((model) => [model.id, model.contextTokens] as const),
    ).toEqual([
      ["apertus-70b-fp8", 16384],
      ["swiss-ai/Apertus-v1.5-8B", 32768],
    ]);
    expect([...catalog.routes]).toEqual([
      ["apertus-70b-fp8", PORT_8000],
      ["swiss-ai/Apertus-v1.5-8B", PORT_8002],
    ]);
  });

  test("no URLs lists nothing", async () => {
    const { calls, fetch } = fakeFetch({});
    const catalog = await listRemoteGpuModels({ baseUrls: [], apiKey: null, fetch });
    expect(catalog.models).toEqual([]);
    expect(catalog.skipped).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("Exoscale servers are labelled as Exoscale and routed per GPU", async () => {
    const GPU_1 = "https://gpu1.example.invalid/v1";
    const GPU_2 = "https://gpu2.example.invalid/v1";
    const { calls, fetch } = fakeFetch({
      [`${GPU_1}/models`]: () =>
        modelList({ id: "swiss-ai/Apertus-8B-Instruct-2509", max_model_len: 32768 }),
      [`${GPU_2}/models`]: () => modelList({ id: "Qwen/Qwen3-8B", max_model_len: 40960 }),
    });

    const catalog = await listRemoteGpuModels({
      baseUrls: [GPU_1, GPU_2],
      apiKey: "synthetic-vllm-key",
      fetch,
      source: EXOSCALE_SOURCE,
    });

    expect(catalog.models).toEqual([
      {
        id: "swiss-ai/Apertus-8B-Instruct-2509",
        name: "swiss-ai/Apertus-8B-Instruct-2509",
        provider: "Exoscale (Switzerland)",
        providerId: "exoscale",
        contextTokens: 32768,
      },
      {
        id: "Qwen/Qwen3-8B",
        name: "Qwen/Qwen3-8B",
        provider: "Exoscale (Switzerland)",
        providerId: "exoscale",
        contextTokens: 40960,
      },
    ]);
    expect([...catalog.routes]).toEqual([
      ["swiss-ai/Apertus-8B-Instruct-2509", GPU_1],
      ["Qwen/Qwen3-8B", GPU_2],
    ]);
    expect(calls.map((call) => call.init.headers)).toEqual([
      { Accept: "application/json", Authorization: "Bearer synthetic-vllm-key" },
      { Accept: "application/json", Authorization: "Bearer synthetic-vllm-key" },
    ]);
  });
});

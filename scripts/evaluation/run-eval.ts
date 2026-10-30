/**
 * Host CLI for the eval harness (C3a). The logic and its tests live in
 * `eval-runner.ts`; this file only wires the real ports.
 *
 *   bun run eval -- --models ollama:qwen3:4b --latency-set
 *   bun run eval -- --models ollama:qwen3:4b --items Q-S1-11,Q-S5-05 --run-id smoke
 *   bun run eval -- --models ollama:qwen3:4b --latency-set --replay
 *
 * The package script passes `--env-file=.env.eval`, a copy of
 * `.env.synthetic.example` pointed at a throwaway database holding only
 * synthea-v4-seed42, so Bun never loads `.env.local`. `--models` must name the
 * provider in that file (one provider per run); on `exoscale` and `remote-gpu`
 * each id must be listed by a vLLM server's `/v1/models` when the run starts.
 *
 * Model calls are recorded under `evaluation/cache/`, runs under
 * `evaluation/runs/<run-id>/`; both are gitignored.
 */
import { execFileSync } from "node:child_process";
import { access, appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type EvalDeps, type ModelSpec, EvalSetupError, runEval } from "./eval-runner";
import { DEFAULT_OLLAMA_BASE_URL } from "../../infrastructure/ollama-context";
import { type CacheStore } from "./model-cache";

const RUNS_DIR = "evaluation/runs";
const CACHE_DIR = "evaluation/cache";

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * One file per key. A write goes to `<key>.json.<pid>.tmp` and is renamed into
 * place, so a run killed mid-write never leaves half an entry under the key.
 */
export const fileCacheStore = (dir: string, pid: number = process.pid): CacheStore => ({
  read: async (key) => {
    const path = join(dir, `${key}.json`);
    return (await exists(path)) ? readFile(path, "utf8") : null;
  },
  write: async (key, text) => {
    await mkdir(dir, { recursive: true });
    const target = join(dir, `${key}.json`);
    const temporary = `${target}.${pid}.tmp`;
    await writeFile(temporary, text);
    await rename(temporary, target);
  },
});

const hostOf = (url: string | null): string | null => (url ? new URL(url).host : null);

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const { serverEnv, infomaniakOpenAiBaseUrl } = await import("../../infrastructure/env");
  const { fetchActiveModelCatalog, vllmBaseUrlFor } =
    await import("../../infrastructure/fetch-model-catalog");
  const { isoLocalDate } = await import("../../infrastructure/format-measure");
  const { createChatTools } = await import("../../features/chat/chat-tools");
  const { resolveLanguageModel } =
    await import("../../features/chat/resolve-language-model");
  const { loadSessionAudit } =
    await import("../../features/chat/response/load-session-audit");

  const env = serverEnv();

  const endpointHost = (spec: ModelSpec): string | null => {
    switch (spec.provider) {
      case "ollama":
        return hostOf(env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL);
      case "exoscale":
      case "remote-gpu":
        return hostOf(vllmBaseUrlFor(spec.provider, spec.modelId));
      case "infomaniak":
        return hostOf(infomaniakOpenAiBaseUrl(env));
      case "openrouter":
        return "openrouter.ai";
      default:
        return null;
    }
  };

  const deps: EvalDeps = {
    dataMode: env.DATA_MODE,
    llmProvider: env.LLM_PROVIDER,
    hasEnv: (name) => Boolean(Reflect.get(env, name)),
    readText: (path) => readFile(path, "utf8"),
    // Read at run time: vLLM providers route each id to the server that lists it.
    listModels: async () =>
      ((await fetchActiveModelCatalog()) ?? []).map((model) => model.id),
    resolveModel: async (spec) => {
      const model = resolveLanguageModel(spec.modelId, { hasWearableNarrative: false });
      if (typeof model === "string") {
        throw new EvalSetupError("MODEL_NOT_LISTED", `${spec.modelId} did not resolve`);
      }
      return { model, mock: false, host: endpointHost(spec) };
    },
    timeoutSignal: (timeoutMs) => AbortSignal.timeout(timeoutMs),
    createTools: (scope) => createChatTools(scope),
    loadAudit: loadSessionAudit,
    cache: fileCacheStore(CACHE_DIR),
    prepareRun: async (runId) => {
      const dir = join(RUNS_DIR, runId);
      if (await exists(dir)) return false;
      await mkdir(dir, { recursive: true });
      return true;
    },
    appendResult: (runId, line) =>
      appendFile(join(RUNS_DIR, runId, "results.jsonl"), line),
    writeMeta: (runId, json) => writeFile(join(RUNS_DIR, runId, "meta.json"), json),
    now: () => performance.now(),
    today: isoLocalDate,
    newRunId: () => `${isoLocalDate()}-${env.LLM_PROVIDER}-${Date.now().toString(36)}`,
    gitSha: () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    openTwinSha: () =>
      execFileSync("git", ["-C", ".open-twin", "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
    platform: `${process.platform}-${process.arch}`,
    logError: (message, detail) => {
      console.error(message, detail);
    },
  };

  const code = await runEval(process.argv.slice(2), process, deps);
  process.exit(code);
}

import { describe, expect, test } from "bun:test";

/**
 * Which models actually call tools. Never CI.
 *
 * Local Ollama:
 *
 *   RUN_LIVE=1 DATABASE_URL=<synthetic warehouse> DATA_MODE=synthetic LOCAL_ONLY=true \
 *     LLM_PROVIDER=ollama LOCAL_MVP=true \
 *     bun test --preload ./features/chat/response/preload-server-only.mjs \
 *     features/chat/tool-calls.live.test.ts
 *
 * Remote GPU (vLLM behind SSH tunnels; synthetic data only):
 *
 *   RUN_LIVE=1 DATABASE_URL=<synthetic warehouse> DATA_MODE=synthetic LOCAL_ONLY=false \
 *     LLM_PROVIDER=remote-gpu LOCAL_MVP=true \
 *     REMOTE_GPU_BASE_URLS=http://127.0.0.1:8000/v1,http://127.0.0.1:8002/v1 \
 *     bun test --preload ./features/chat/response/preload-server-only.mjs \
 *     features/chat/tool-calls.live.test.ts
 *
 * LIVE_MODELS=a,b limits the run to listed models; otherwise every chat model
 * the provider lists is tried. One question per model. LIVE_TIMEOUT_S (default
 * 300) aborts one model's answer so a stuck model cannot hold a rented GPU.
 * LIVE_COHORT defaults to synthea-v4-seed42 (B1 seed). Writes only
 * synthetic-scope audit rows.
 */
const runLive = Reflect.get(process.env, "RUN_LIVE") === "1";
const HEART_RATE_LOINC = "8867-4";

type ModelRun = {
  readonly model: string;
  readonly calls: readonly { readonly tool: string; readonly rowCount: number }[];
  readonly failure: string | null;
  readonly seconds: number;
};

const listFromEnv = (name: string): readonly string[] =>
  String(Reflect.get(process.env, name) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

describe.skipIf(!runLive)("tool calls by model (RUN_LIVE=1)", () => {
  test(
    "each model makes at least one audited tool call for a synthetic subject",
    async () => {
      const { isStepCount, streamText } = await import("ai");
      const { database } = await import("@/infrastructure/database");
      const { serverEnv } = await import("@/infrastructure/env");
      const { fetchActiveModelCatalog } =
        await import("@/infrastructure/fetch-model-catalog");
      const { runLatestByLoinc, runListSubjects } =
        await import("@/packages/query-tools/tools");
      const { createChatTools } = await import("./chat-tools");
      const { resolveLanguageModel } = await import("./resolve-language-model");
      const { buildTwinSystemPrompt } = await import("./twin-system-prompt");

      const env = serverEnv();
      expect(env.DATA_MODE).toBe("synthetic");
      // Ollama only counts as local with LOCAL_ONLY; the remote GPU never does.
      expect(["ollama LOCAL_ONLY=true", "remote-gpu LOCAL_ONLY=false"]).toContain(
        `${env.LLM_PROVIDER} LOCAL_ONLY=${String(env.LOCAL_ONLY)}`,
      );

      const runId = `live-smoke-${Date.now()}`;
      const setup = {
        actor: "live-smoke",
        sessionId: `${runId}-setup`,
        mode: "synthetic" as const,
      };
      const cohort = listFromEnv("LIVE_COHORT")[0] ?? "synthea-v4-seed42";
      const listed = await runListSubjects(setup, { cohort_id: cohort });
      if (!("subjects" in listed)) throw new Error(`cohort ${cohort} is out of scope`);

      // First subject that really has a heart-rate row, so "no rows" is never the right answer.
      let subjectRef: string | null = null;
      for (const { subject_ref } of listed.subjects) {
        const latest = await runLatestByLoinc(setup, {
          subject_ref,
          loinc: [HEART_RATE_LOINC],
        });
        if ("rows" in latest && latest.rows.length > 0) {
          subjectRef = subject_ref;
          break;
        }
      }
      if (!subjectRef) throw new Error(`no ${HEART_RATE_LOINC} rows in cohort ${cohort}`);

      // Always read the catalog: the remote GPU routes each id to the URL that
      // listed it, and a model nobody serves must read "not listed", not "no call".
      const served = ((await fetchActiveModelCatalog()) ?? []).map((model) => model.id);
      const fromEnv = listFromEnv("LIVE_MODELS");
      const models = fromEnv.length > 0 ? fromEnv : served;
      expect(models.length).toBeGreaterThan(0);
      const timeoutSeconds = Number(listFromEnv("LIVE_TIMEOUT_S")[0] ?? "300");

      const system = buildTwinSystemPrompt({
        mode: "synthetic",
        oura: null,
        whoop: null,
        googleHealth: null,
        vitronic: null,
      });
      const prompt = `What is the latest heart rate (LOINC ${HEART_RATE_LOINC}) recorded for subject_ref ${subjectRef}?`;

      const runs: ModelRun[] = [];
      for (const model of models) {
        if (!served.includes(model)) {
          runs.push({ model, calls: [], failure: "not listed", seconds: 0 });
          continue;
        }
        const sessionId = `${runId}-${model}`;
        let failure: string | null = null;
        const started = Date.now();
        try {
          // Streaming, like the chat route: a long thinking pass keeps the connection alive.
          const result = streamText({
            model: resolveLanguageModel(model, { hasWearableNarrative: false }),
            system,
            prompt,
            tools: createChatTools({ actor: "live-smoke", sessionId, mode: "synthetic" }),
            stopWhen: isStepCount(8),
            abortSignal: AbortSignal.timeout(timeoutSeconds * 1000),
          });
          await result.text;
        } catch (error) {
          failure = error instanceof Error ? error.name : "error";
        }
        const audited = await database().auditEvent.findMany({
          where: { sessionId },
          orderBy: { seq: "asc" },
          select: { tool: true, rowCount: true },
        });
        runs.push({
          model,
          calls: audited,
          failure,
          seconds: Math.round((Date.now() - started) / 1000),
        });
      }

      process.stdout.write(`subject_ref=${subjectRef} cohort=${cohort}\n`);
      for (const run of runs) {
        const calls =
          run.calls.length > 0
            ? run.calls.map((call) => `${call.tool} rows=${call.rowCount}`).join(", ")
            : "no tool call";
        process.stdout.write(
          `${run.model}\t${calls}\t${run.seconds}s${run.failure ? `\tfailed: ${run.failure}` : ""}\n`,
        );
      }

      expect(
        runs.filter((run) => run.calls.length === 0).map((run) => run.model),
      ).toEqual([]);
    },
    { timeout: 30 * 60_000 },
  );
});

import { describe, expect, test } from "bun:test";

import { createStarterGenerate } from "./starter-generate";
import { createStarterQuestionsHandler } from "./starter-handler";

const call = { system: "sys", prompt: "p", abortSignal: new AbortController().signal };

describe("createStarterGenerate", () => {
  test("passes hasLinkedData to the provider policy and uses the first model", async () => {
    const resolved: string[] = [];
    const generate = createStarterGenerate({
      loadModelIds: async () => ["qwen3:8b", "gemma3:4b"],
      resolveModel: (modelId, { hasWearableNarrative }) => {
        resolved.push(`${modelId} ${String(hasWearableNarrative)}`);
        return modelId;
      },
      recordSend: async () => undefined,
      generateText: async ({ model, system, prompt, maxRetries }) => ({
        text: `${model}|${system}|${prompt}|${String(maxRetries)}`,
      }),
    });
    expect(await generate(true, "local")(call)).toBe("qwen3:8b|sys|p|0");
    expect(await generate(false, "local")(call)).toBe("qwen3:8b|sys|p|0");
    expect(resolved).toEqual(["qwen3:8b true", "qwen3:8b false"]);
  });

  test("records the send after the provider policy and before the model call", async () => {
    const steps: string[] = [];
    const generate = createStarterGenerate({
      loadModelIds: async () => ["swiss-ai/Apertus-8B-Instruct-2509"],
      resolveModel: (modelId) => {
        steps.push("resolve");
        return modelId;
      },
      recordSend: async (input) => {
        steps.push(
          `audit ${input.actor} ${input.modelId} ${String(input.hasWearableNarrative)}`,
        );
      },
      generateText: async () => {
        steps.push("generate");
        return { text: "ok" };
      },
    });
    expect(await generate(true, "user_synthetic_1")(call)).toBe("ok");
    expect(steps).toEqual([
      "resolve",
      "audit user_synthetic_1 swiss-ai/Apertus-8B-Instruct-2509 true",
      "generate",
    ]);
  });

  test("a refused provider is never audited and never called", async () => {
    const steps: string[] = [];
    const generate = createStarterGenerate({
      loadModelIds: async () => ["synthetic-model"],
      resolveModel: (): string => {
        throw new Error("PROVIDER_NOT_PERMITTED_FOR_DATA_MODE");
      },
      recordSend: async () => {
        steps.push("audit");
      },
      generateText: async () => {
        steps.push("generate");
        return { text: "never" };
      },
    });
    await expect(generate(true, "local")(call)).rejects.toThrow(
      "PROVIDER_NOT_PERMITTED_FOR_DATA_MODE",
    );
    expect(steps).toEqual([]);
  });

  test("no catalog is an error, which the starter step turns into fixed starters", async () => {
    const generate = createStarterGenerate({
      loadModelIds: async () => null,
      resolveModel: () => "never",
      recordSend: async () => undefined,
      generateText: async () => ({ text: "never" }),
    });
    await expect(generate(false, "local")(call)).rejects.toThrow(
      "No model in the active catalog",
    );
  });
});

describe("starter questions with a failed audit write", () => {
  test("fall back to the fixed starters without calling the model", async () => {
    const steps: string[] = [];
    const logged: string[] = [];
    const handler = createStarterQuestionsHandler({
      resolveActorId: async () => "user_synthetic_1",
      findAppUserId: async () => "app-user-synthetic-1",
      loadLinkedNames: async () => ["Whoop"],
      generate: createStarterGenerate({
        loadModelIds: async () => ["swiss-ai/Apertus-8B-Instruct-2509"],
        resolveModel: (modelId) => modelId,
        recordSend: async ({ actor }) => {
          steps.push(`audit ${actor}`);
          throw new Error("audit-down");
        },
        generateText: async () => {
          steps.push("generate");
          return { text: "What does HRV measure on my ring?" };
        },
      }),
      timeoutMs: 1000,
      logError: (message, name) => logged.push(`${message} ${name}`),
    });
    const response = await handler(
      new Request("http://localhost/api/onboarding/starters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roles: ["student"], dataChoice: null, interest: "" }),
      }),
    );
    const body = (await response.json()) as { source: string };
    expect(response.status).toBe(200);
    expect(body.source).toBe("fallback");
    expect(steps).toEqual(["audit user_synthetic_1"]);
    expect(logged).toEqual(["[onboarding] starter questions failed Error"]);
    expect(JSON.stringify(body)).not.toContain("audit-down");
  });
});

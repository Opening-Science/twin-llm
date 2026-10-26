import { describe, expect, test } from "bun:test";

import { MockLanguageModelV4 } from "ai/test";

import { ALL_KNOWLEDGE_SOURCES } from "@/infrastructure/knowledge-sources";
import type { QueryToolPorts } from "@/packages/query-tools/ports";

import { createChatTools, forSources } from "./chat-tools";
import { runTwinTurn } from "./run-twin-turn";

/**
 * Source choices from /start against the real chat tool set: every
 * tool has an owning source, and a source turned off never reaches the model.
 * Fake model and fake query ports only.
 */

const ports: QueryToolPorts = {
  findSubject: async () => null,
  findObservations: async () => [],
  appendAudit: async () => undefined,
};

const SCOPE = { actor: "test", sessionId: "turn-src", mode: "synthetic" } as const;
const PERSONAL = { actor: "test", sessionId: "turn-src", mode: "personal" } as const;
const NO_WEARABLES = { oura: null, whoop: null, googleHealth: null, vitronic: null };

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

const answer = () => ({
  stream: new ReadableStream({
    start: (controller) => {
      [
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "ok" },
        { type: "text-end", id: "t" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
      ].forEach((part) => controller.enqueue(part as never));
      controller.close();
    },
  }),
});

const sentTo = async (
  disabled: Parameters<typeof forSources>[1],
  hasWearableNarrative = false,
) => {
  const model = new MockLanguageModelV4({ doStream: async () => answer() });
  const { tools, offeredTools } = forSources(
    createChatTools(SCOPE, { query: ports, hasWearableNarrative }),
    disabled,
  );
  await new Promise<void>((resolve, reject) => {
    const result = runTwinTurn(
      { model, tools, offeredTools, mode: "synthetic", loadAudit: async () => [] },
      {
        turnId: "turn-src",
        messages: [{ role: "user", content: "Question" }],
        wearables: NO_WEARABLES,
      },
      {
        onFirstToken: () => undefined,
        onFinish: async () => resolve(),
        onError: async (error) => reject(error),
        onAbort: () => reject(new Error("aborted")),
      },
    );
    void result.consumeStream();
  });
  const call = model.doStreamCalls[0];
  const system = call?.prompt[0];
  return {
    tools: (call?.tools ?? []).map((tool) => tool.name).sort(),
    system: system && system.role === "system" ? system.content : "",
  };
};

describe("chat tools and knowledge sources", () => {
  test("every chat tool is owned by exactly one source", () => {
    const owned = ALL_KNOWLEDGE_SOURCES.flatMap((source) => source.tools);
    expect([...owned].sort()).toEqual(
      Object.keys(createChatTools(SCOPE, { query: ports })).sort(),
    );
    expect(new Set(owned).size).toBe(owned.length);
  });

  test("turning guidelines off removes guideline_search from what the model gets", async () => {
    const all = await sentTo([]);
    const withoutGuidelines = await sentTo(["guidelines"]);
    expect(all.tools).toContain("guideline_search");
    expect(withoutGuidelines.tools).toEqual(
      all.tools.filter((name) => name !== "guideline_search"),
    );
    expect(all.system).toContain("`guideline_search` gives guideline passages");
    expect(withoutGuidelines.system).not.toContain("guideline_search");
  });

  test("a personal request never gets the remote GBD server's tool", () => {
    const names = (scope: typeof SCOPE | typeof PERSONAL, wearables: boolean) =>
      Object.keys(
        createChatTools(scope, { query: ports, hasWearableNarrative: wearables }),
      ).sort();
    expect(names(SCOPE, false)).toContain("gbd_population");
    expect(names(SCOPE, true)).not.toContain("gbd_population");
    expect(names(PERSONAL, false)).not.toContain("gbd_population");
    expect(names(SCOPE, true)).toEqual(
      names(SCOPE, false).filter((name) => name !== "gbd_population"),
    );
  });

  test("the prompt does not name a withheld tool", async () => {
    const { tools, system } = await sentTo([], true);
    expect(tools).not.toContain("gbd_population");
    expect(system).not.toContain("gbd_population");
    expect(system).toContain("`guideline_search` gives guideline passages");
  });

  test("turning cohort records off also removes the analytics tools", async () => {
    const { tools } = await sentTo(["cohort-records"]);
    expect(tools).toEqual(["gbd_population", "guideline_search", "knowledge_search"]);
  });
});

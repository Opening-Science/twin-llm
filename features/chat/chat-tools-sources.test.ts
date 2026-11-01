import { describe, expect, test } from "bun:test";

import { MockLanguageModelV4 } from "ai/test";

import { ALL_KNOWLEDGE_SOURCES } from "@/infrastructure/knowledge-sources";
import type { GbdEstimatePorts } from "@/packages/query-tools/gbd-estimate";
import type { ImportedToolDeps } from "@/packages/query-tools/imported-tools";
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
  test("every chat tool but the view tools is owned by exactly one source", () => {
    const owned = ALL_KNOWLEDGE_SOURCES.flatMap((source) => source.tools);
    // The genome and imported-data tools are owned too, but only a turn their
    // policies permit gets them.
    expect([...owned, "show_view", "list_views", "open_view"].sort()).toEqual(
      [
        ...Object.keys(createChatTools(SCOPE, { query: ports })),
        "dna_ask",
        "gbd_estimate",
        "genome_report",
        "genome_variants",
        "imported_conditions",
        "imported_datasets",
        "imported_latest",
        "imported_medications",
        "imported_table",
        "imported_trend",
      ].sort(),
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
    expect(tools).toEqual([
      "cross_source_compare",
      "gbd_population",
      "guideline_search",
      "hrv_trend",
      "knowledge_search",
      "list_views",
      "open_view",
      "resting_hr_trend",
      "show_view",
      "sleep_summary",
      "training_load",
    ]);
  });

  test("turning the wearable source off removes the four wearable tools only", async () => {
    const { tools } = await sentTo(["wearable-analytics"]);
    expect(
      [
        "sleep_summary",
        "hrv_trend",
        "resting_hr_trend",
        "training_load",
        "cross_source_compare",
      ].filter((name) => tools.includes(name)),
    ).toEqual([]);
    expect(tools).toContain("trend");
  });
});

describe("the local GBD store (#387)", () => {
  const gbdLocal: GbdEstimatePorts = {
    catalog: async () => ({ locations: [], causes: [], risks: [] }),
    findEstimates: async () => [],
    appendAudit: async () => undefined,
  };
  const names = (scope: typeof SCOPE | typeof PERSONAL, local?: GbdEstimatePorts) =>
    Object.keys(createChatTools(scope, { query: ports, gbdLocal: local })).filter(
      (name) => name.startsWith("gbd_"),
    );

  test("with estimates imported, both modes get gbd_estimate and not the remote tool", () => {
    expect(names(SCOPE, gbdLocal)).toEqual(["gbd_estimate"]);
    expect(names(PERSONAL, gbdLocal)).toEqual(["gbd_estimate"]);
  });

  test("without them the remote tool stays as before", () => {
    expect(names(SCOPE)).toEqual(["gbd_population"]);
    expect(names(PERSONAL)).toEqual([]);
  });

  test("turning the GBD source off removes gbd_estimate too", () => {
    const { tools } = forSources(createChatTools(SCOPE, { query: ports, gbdLocal }), [
      "gbd",
    ]);
    expect(Object.keys(tools).filter((name) => name.startsWith("gbd_"))).toEqual([]);
  });
});

describe("imported-data tools", () => {
  const imported = (scope: typeof SCOPE | typeof PERSONAL): ImportedToolDeps => ({
    scope,
    permit: () => ({ ok: true }),
    ports: {
      listDatasets: async () => [],
      listSeries: async () => [],
      findLatest: async () => [],
      findSeries: async () => [],
      listTables: async () => [],
      readTableRows: async () => [],
      findConditions: async () => [],
      findMedications: async () => [],
      appendAudit: async () => undefined,
    },
  });
  const IMPORTED = [
    "imported_datasets",
    "imported_latest",
    "imported_trend",
    "imported_table",
    "imported_conditions",
    "imported_medications",
  ];
  const names = (scope: typeof SCOPE | typeof PERSONAL, deps?: ImportedToolDeps) =>
    Object.keys(createChatTools(scope, { query: ports, imported: deps }));

  test("a personal turn the policy allowed gets them", () => {
    expect(
      names(PERSONAL, imported(PERSONAL)).filter((name) => IMPORTED.includes(name)),
    ).toEqual(IMPORTED);
  });

  test("without their ports, or in a synthetic scope, there are none", () => {
    expect(names(PERSONAL).filter((name) => IMPORTED.includes(name))).toEqual([]);
    expect(
      names(SCOPE, imported(SCOPE)).filter((name) => IMPORTED.includes(name)),
    ).toEqual([]);
  });

  test("turning the imported-data source off removes them", () => {
    const { offeredTools } = forSources(
      createChatTools(PERSONAL, { query: ports, imported: imported(PERSONAL) }),
      ["imported-data"],
    );
    expect([...(offeredTools ?? [])].filter((name) => IMPORTED.includes(name))).toEqual(
      [],
    );
  });
});

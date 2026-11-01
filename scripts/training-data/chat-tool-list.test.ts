import { describe, expect, test } from "bun:test";

import { createChatTools } from "../../features/chat/chat-tools";
import { openaiToolList } from "../../packages/query-tools/manifests";
import type { GbdEstimatePorts } from "../../packages/query-tools/gbd-estimate";
import type { QueryToolPorts } from "../../packages/query-tools/ports";

import { openAiToolsFrom } from "./chat-tool-list";

const ports: QueryToolPorts = {
  findSubject: async () => null,
  findObservations: async () => [],
  appendAudit: async () => undefined,
};

const SCOPE = { actor: "test", sessionId: "tools", mode: "synthetic" } as const;

describe("openAiToolsFrom", () => {
  test("the training tools are the ones a chat request sends, in order", async () => {
    const tools = await openAiToolsFrom(createChatTools(SCOPE, { query: ports }));
    expect(tools.map((tool) => tool.function.name)).toEqual([
      "list_subjects",
      "subject_window",
      "observations_for_subject",
      "latest_by_loinc",
      "summary_stats",
      "trend",
      "baseline_deviation",
      "coverage",
      "compare_windows",
      "range_position",
      "convert_unit",
      "cohort_position",
      "conditions_timeline",
      "medications_timeline",
      "sleep_summary",
      "hrv_trend",
      "resting_hr_trend",
      "training_load",
      "cross_source_compare",
      "values_around_event",
      "rhythm_irregularity",
      "cohort_event_rates",
      "show_view",
      "list_views",
      "open_view",
      "gbd_population",
      "guideline_search",
      "knowledge_search",
    ]);
  });

  test("the query tools and view tools are in the slim form the manifest gives models", async () => {
    // With GBD results imported (#387), gbd_estimate follows the view tools, as in the manifest.
    const gbdLocal: GbdEstimatePorts = {
      catalog: async () => ({ locations: [], causes: [], risks: [] }),
      findEstimates: async () => [],
      appendAudit: async () => undefined,
    };
    const tools = await openAiToolsFrom(
      createChatTools(SCOPE, { query: ports, gbdLocal }),
    );
    expect(tools.slice(0, openaiToolList().length)).toEqual(openaiToolList());
  });

  test("the reference tools keep their own schemas", async () => {
    const tools = await openAiToolsFrom(createChatTools(SCOPE, { query: ports }));
    const search = tools.find((tool) => tool.function.name === "guideline_search");
    expect(search?.function.parameters.required).toEqual(["query"]);
    expect(Object.keys(search?.function.parameters.properties ?? {})).toEqual([
      "query",
      "k",
    ]);
  });

  test("a personal turn is not offered the synthetic-only cohort_event_rates (#293)", async () => {
    const personal = { ...SCOPE, mode: "personal" } as const;
    const names = (
      await openAiToolsFrom(createChatTools(personal, { query: ports }))
    ).map((tool) => tool.function.name);
    expect(names).not.toContain("cohort_event_rates");
    expect(names).toContain("rhythm_irregularity");
  });
});

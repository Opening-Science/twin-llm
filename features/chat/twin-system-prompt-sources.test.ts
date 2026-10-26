import { describe, expect, test } from "bun:test";

import { buildTwinSystemPrompt } from "./twin-system-prompt";

const noWearables = {
  oura: null,
  whoop: null,
  googleHealth: null,
  vitronic: null,
} as const;

const cohortSection = (prompt: string): string =>
  prompt.slice(
    prompt.indexOf("## Data mode: synthetic research cohort"),
    prompt.indexOf("## Wearable context (Oura)"),
  );

describe("system prompt with sources turned off", () => {
  test("leaves out the chart line when show_view is not offered", () => {
    const prompt = buildTwinSystemPrompt({
      ...noWearables,
      mode: "personal",
      offeredTools: new Set(),
    });
    expect(prompt).not.toContain("show_view");
    expect(buildTwinSystemPrompt({ ...noWearables, mode: "personal" })).toContain(
      "## Charts\nTo show a measure over time, call `show_view`",
    );
  });

  test("names only the tools the turn carries", () => {
    const prompt = buildTwinSystemPrompt({
      ...noWearables,
      mode: "synthetic",
      // Records off takes analytics with it, so only reference tools remain.
      offeredTools: new Set(["knowledge_search"]),
    });
    expect(cohortSection(prompt)).toBe(
      [
        "## Data mode: synthetic research cohort",
        "This session reads a synthetic research cohort generated with Synthea. The rows describe no real person.",
        "- The cohort record tools are turned off for this user. If a question needs cohort rows, say so under Uncertainty and do not guess values.",
        "- `knowledge_search` explains TwinLLM's own metrics, units, data sources and limits.",
        "- Cite tool results in Reasoning by tool, subject_ref, LOINC and date; they are recorded in tool_calls. Tool rows are not wearable keys, so they do not go under Evidence Used.",
        "- When a tool returns no rows or refuses a subject, say so plainly and do not guess values.",
        "",
        "",
      ].join("\n"),
    );
  });

  test("every tool offered gives the same prompt as no list at all", () => {
    const all = new Set([
      "list_subjects",
      "latest_by_loinc",
      "gbd_population",
      "guideline_search",
      "knowledge_search",
      "show_view",
      "list_views",
      "open_view",
    ]);
    expect(
      buildTwinSystemPrompt({ ...noWearables, mode: "synthetic", offeredTools: all }),
    ).toBe(buildTwinSystemPrompt({ ...noWearables, mode: "synthetic" }));
  });

  test("personal mode is unchanged by the list", () => {
    expect(
      buildTwinSystemPrompt({
        ...noWearables,
        mode: "personal",
        offeredTools: new Set(["show_view", "list_views", "open_view"]),
      }),
    ).toBe(buildTwinSystemPrompt({ ...noWearables, mode: "personal" }));
  });

  test("the reopen line is there only when open_view is offered", () => {
    const line = "call `list_views` and then `open_view` with its id";
    const prompt = (tools: readonly string[]) =>
      buildTwinSystemPrompt({
        ...noWearables,
        mode: "personal",
        offeredTools: new Set(tools),
      });
    expect(prompt(["show_view", "list_views", "open_view"])).toContain(line);
    expect(prompt(["show_view"])).not.toContain(line);
  });
});

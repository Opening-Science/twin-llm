import { describe, expect, test } from "bun:test";

import { GENOME_TOOL_DEFINITIONS } from "@/packages/carbon-x/schema";
import { IMPORTED_TOOL_DEFINITIONS } from "@/packages/query-tools/imported-schemas";
import { TOOL_DEFINITIONS } from "@/packages/query-tools/schemas";
import { showViewInput, VIEW_TOOL_DEFINITIONS } from "@/packages/query-tools/view-schema";

import { buildTwinSystemPrompt } from "./twin-system-prompt";

const descriptionOf = (
  definitions: readonly Readonly<{ name: string; description: string }>[],
  name: string,
): string =>
  definitions.find((definition) => definition.name === name)?.description ?? "";

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
      "observations_for_subject",
      "subject_window",
      "summary_stats",
      "conditions_timeline",
      "medications_timeline",
      "gbd_population",
      "guideline_search",
      "knowledge_search",
      "show_view",
      "list_views",
      "open_view",
      "convert_unit",
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
        offeredTools: new Set(["show_view", "list_views", "open_view", "convert_unit"]),
      }),
    ).toBe(buildTwinSystemPrompt({ ...noWearables, mode: "personal" }));
  });

  test("the units rule is in convert_unit's description, not the prompt (#393)", () => {
    const prompt = (mode: "personal" | "synthetic", tools: readonly string[]) =>
      buildTwinSystemPrompt({ ...noWearables, mode, offeredTools: new Set(tools) });
    expect(prompt("synthetic", ["convert_unit"])).not.toContain("## Units");
    expect(prompt("personal", ["convert_unit"])).not.toContain("convert_unit");
    expect(descriptionOf(TOOL_DEFINITIONS, "convert_unit")).toContain(
      "Use it for every unit conversion, never convert in the answer text; if refused, give the value in the unit it came in.",
    );
  });

  test("reopening a chart and the other view kinds are in the view tools' descriptions (#393)", () => {
    const prompt = buildTwinSystemPrompt({
      ...noWearables,
      mode: "personal",
      offeredTools: new Set(["show_view", "list_views", "open_view"]),
    });
    expect(prompt).not.toContain("list_views");
    expect(prompt).not.toContain("Other kinds");
    expect(descriptionOf(VIEW_TOOL_DEFINITIONS, "open_view")).toContain(
      "by its list_views id",
    );
    expect(descriptionOf(VIEW_TOOL_DEFINITIONS, "show_view")).toContain(
      "chart.compare: window against compare_with (n and mean each)",
    );
  });

  test("twin.body without a window uses each marker's latest reading (#393)", () => {
    expect(showViewInput.shape.window.description).toBe(
      "Needed except for twin.body and map.choropleth; twin.body without it uses each marker's latest reading",
    );
  });
});

describe("imported-data and genome guidance (#393)", () => {
  test("lives in the tools' descriptions, paid only when the tools are offered", () => {
    const prompt = buildTwinSystemPrompt({
      ...noWearables,
      mode: "personal",
      offeredTools: new Set([
        "imported_datasets",
        "imported_latest",
        "imported_trend",
        "genome_report",
        "dna_ask",
      ]),
    });
    expect(prompt).not.toContain("## Imported data");
    expect(prompt).not.toContain("## Genome");
    expect(descriptionOf(IMPORTED_TOOL_DEFINITIONS, "imported_datasets")).toContain(
      "Call it first; cite a value with its dataset and date as stored.",
    );
    expect(descriptionOf(IMPORTED_TOOL_DEFINITIONS, "imported_trend")).toContain(
      "A series stored by name is not the LOINC of a similar name (HRV RMSSD is not SDNN, 80404-7): never combine them or mix datasets in one trend.",
    );
    expect(descriptionOf(GENOME_TOOL_DEFINITIONS, "dna_ask")).toContain(
      "Quote its answer labelled Carbon-X (research model): research output, not a fact about the person. Say what a variant is known to affect; never give a dose or say to start, stop or change a medicine.",
    );
    expect(descriptionOf(GENOME_TOOL_DEFINITIONS, "genome_report")).toContain(
      "no call (the call file has nothing there; not the reference allele)",
    );
  });
});

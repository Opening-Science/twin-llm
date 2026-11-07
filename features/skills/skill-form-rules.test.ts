import { describe, expect, test } from "bun:test";

import { ALL_KNOWLEDGE_SOURCES } from "@/infrastructure/knowledge-sources";

import {
  type SkillSelection,
  tickSource,
  tickTool,
  unreadSources,
  unreadSourcesNote,
} from "./skill-form-rules";
import {
  CHAT_TOOL_NAMES,
  SKILL_SOURCE_IDS,
  skillFrontmatterSchema,
} from "./skill-schema";

const NONE: SkillSelection = { sources: [], tools: [] };

const schemaAccepts = (selection: SkillSelection): boolean =>
  skillFrontmatterSchema.safeParse({
    name: "mine",
    description: "A skill of my own.",
    sources: selection.sources,
    tools: selection.tools,
    providers: ["ollama"],
  }).success;

/** The skill form's tick rules (#486), checked against the schema that saves. */
describe("skill form rules", () => {
  test("ticking a source ticks its tools, so the preview never reads without calling", () => {
    expect(tickSource(NONE, "opentwin-knowledge", true)).toEqual({
      sources: ["opentwin-knowledge"],
      tools: ["knowledge_search"],
    });
  });

  test("ticking a source ticks the source it needs, with that source's tools", () => {
    expect(tickSource(NONE, "wearable-analytics", true)).toEqual({
      sources: ["wearable-analytics", "wearable-context"],
      tools: [
        "sleep_summary",
        "hrv_trend",
        "resting_hr_trend",
        "training_load",
        "cross_source_compare",
      ],
    });
    expect(tickSource(NONE, "cohort-analytics", true).sources).toEqual([
      "cohort-analytics",
      "cohort-records",
    ]);
  });

  test("ticking one tool ticks its source without the other tools", () => {
    expect(tickTool(NONE, "trend", true)).toEqual({
      sources: ["cohort-analytics", "cohort-records"],
      tools: [
        "trend",
        "list_subjects",
        "subject_window",
        "observations_for_subject",
        "latest_by_loinc",
        "summary_stats",
        "conditions_timeline",
        "medications_timeline",
      ],
    });
  });

  test("unticking a source unticks its tools and the sources that need it", () => {
    const both = tickSource(NONE, "cohort-analytics", true);
    expect(tickSource(both, "cohort-records", false)).toEqual(NONE);
    const wearables = tickSource(NONE, "wearable-analytics", true);
    expect(tickSource(wearables, "wearable-context", false)).toEqual(NONE);
  });

  test("unticking the last tool keeps the source and the form says it reads nothing", () => {
    const notes = tickTool(
      tickSource(NONE, "opentwin-knowledge", true),
      "knowledge_search",
      false,
    );
    expect(notes).toEqual({ sources: ["opentwin-knowledge"], tools: [] });
    expect(schemaAccepts(notes)).toBe(true);
    expect(unreadSources(notes)).toEqual(["opentwin-knowledge"]);
    expect(unreadSourcesNote(unreadSources(notes))).toBe(
      "OpenTwin knowledge notes is read only through its tools. Tick one, or the skill reads nothing from it.",
    );
  });

  test("linked wearables need no tool, so they are never unread", () => {
    const context = tickSource(NONE, "wearable-context", true);
    expect(context).toEqual({ sources: ["wearable-context"], tools: [] });
    expect(unreadSources(context)).toEqual([]);
    expect(unreadSourcesNote([])).toBe(null);
  });

  test("every single tick and untick leaves a selection the schema accepts", () => {
    const bySource = SKILL_SOURCE_IDS.map((id) => tickSource(NONE, id, true));
    const byTool = CHAT_TOOL_NAMES.map((tool) => tickTool(NONE, tool, true));
    const unticked = ALL_KNOWLEDGE_SOURCES.flatMap((source) =>
      SKILL_SOURCE_IDS.map((id) =>
        tickSource(tickSource(NONE, source.id, true), id, false),
      ),
    );
    const refused = [...bySource, ...byTool, ...unticked].filter(
      (selection) => selection.sources.length > 0 && !schemaAccepts(selection),
    );
    expect(refused).toEqual([]);
  });
});

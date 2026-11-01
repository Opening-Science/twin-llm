import { describe, expect, test } from "bun:test";

import {
  disabledToolNames,
  groupOnCount,
  KNOWLEDGE_SOURCE_GROUPS,
  normaliseDisabledSources,
  setGroupEnabled,
  setSourceEnabled,
  withoutDisabledTools,
} from "./knowledge-sources";

const CHAT_TOOL_NAMES = [
  "list_subjects",
  "subject_window",
  "observations_for_subject",
  "latest_by_loinc",
  "summary_stats",
  "trend",
  "baseline_deviation",
  "coverage",
  "compare_windows",
  "gbd_population",
  "guideline_search",
  "knowledge_search",
] as const;

const tools = Object.fromEntries(CHAT_TOOL_NAMES.map((name) => [name, `tool:${name}`]));
const group = (id: string) => {
  const found = KNOWLEDGE_SOURCE_GROUPS.find((item) => item.id === id);
  if (!found) throw new Error(`no group ${id}`);
  return found;
};

describe("knowledge source preferences", () => {
  test("stored ids are cleaned: unknown and repeated ids go, catalogue order", () => {
    expect(normaliseDisabledSources(["gbd", "pubmed", "guidelines", "gbd", 7])).toEqual([
      "guidelines",
      "gbd",
    ]);
    expect(normaliseDisabledSources(null)).toEqual([]);
    expect(normaliseDisabledSources("gbd")).toEqual([]);
  });

  test("disabled sources map to their tool names", () => {
    expect([...disabledToolNames(["cohort-analytics", "gbd"])].sort()).toEqual([
      "baseline_deviation",
      "cohort_event_rates",
      "cohort_position",
      "compare_windows",
      "convert_unit",
      "coverage",
      "gbd_estimate",
      "gbd_population",
      "range_position",
      "rhythm_irregularity",
      "trend",
      "values_around_event",
    ]);
  });

  test("withoutDisabledTools drops only the tools of disabled sources", () => {
    const kept = withoutDisabledTools(tools, ["guidelines", "cohort-analytics"]);
    expect(Object.keys(kept)).toEqual([
      "list_subjects",
      "subject_window",
      "observations_for_subject",
      "latest_by_loinc",
      "summary_stats",
      "gbd_population",
      "knowledge_search",
    ]);
    expect(kept.list_subjects).toBe("tool:list_subjects");
    expect(Object.keys(withoutDisabledTools(tools, []))).toEqual([...CHAT_TOOL_NAMES]);
    expect(withoutDisabledTools({ unowned: 1 }, ["gbd"])).toEqual({ unowned: 1 });
  });

  test("group counts and switches use only sources usable on this server", () => {
    const all = () => true;
    const noCohort = (id: string) => id !== "cohort-records" && id !== "cohort-analytics";
    expect(groupOnCount(group("reference"), ["guidelines"], all)).toEqual({
      on: 1,
      total: 2,
    });
    expect(groupOnCount(group("cohort"), [], noCohort)).toEqual({ on: 0, total: 0 });

    const off = setGroupEnabled([], group("reference"), false, all);
    expect(off).toEqual(["guidelines", "opentwin-knowledge"]);
    expect(setGroupEnabled(off, group("reference"), true, all)).toEqual([]);
    // An unusable source keeps its stored setting when its group is switched.
    expect(setGroupEnabled(["cohort-records"], group("cohort"), true, noCohort)).toEqual([
      "cohort-records",
      "cohort-analytics",
    ]);
  });

  test("analytics depend on cohort records", () => {
    expect(normaliseDisabledSources(["cohort-records"])).toEqual([
      "cohort-records",
      "cohort-analytics",
    ]);
    expect(setSourceEnabled([], "cohort-records", false)).toEqual([
      "cohort-records",
      "cohort-analytics",
    ]);
    // Turning analytics back on brings records with it.
    expect(
      setSourceEnabled(
        ["cohort-records", "cohort-analytics", "gbd"],
        "cohort-analytics",
        true,
      ),
    ).toEqual(["gbd"]);
    // Records alone can come back on while analytics stay off.
    expect(
      setSourceEnabled(["cohort-records", "cohort-analytics"], "cohort-records", true),
    ).toEqual(["cohort-analytics"]);
    expect([...disabledToolNames(["cohort-records"])].sort()).toEqual([
      "baseline_deviation",
      "cohort_event_rates",
      "cohort_position",
      "compare_windows",
      "conditions_timeline",
      "convert_unit",
      "coverage",
      "latest_by_loinc",
      "list_subjects",
      "medications_timeline",
      "observations_for_subject",
      "range_position",
      "rhythm_irregularity",
      "subject_window",
      "summary_stats",
      "trend",
      "values_around_event",
    ]);
  });

  test("the wearable tools belong to their own source, in both data modes' toggles", () => {
    expect([...disabledToolNames(["wearable-analytics"])].sort()).toEqual([
      "cross_source_compare",
      "hrv_trend",
      "resting_hr_trend",
      "sleep_summary",
      "training_load",
    ]);
    expect(group("wearables").sources.map((source) => source.id)).toEqual([
      "wearable-analytics",
    ]);
    expect(normaliseDisabledSources(["cohort-records"])).not.toContain(
      "wearable-analytics",
    );
  });

  test("setSourceEnabled toggles one id without duplicates", () => {
    expect(setSourceEnabled(["gbd"], "gbd", false)).toEqual(["gbd"]);
    expect(setSourceEnabled(["gbd"], "guidelines", false)).toEqual(["guidelines", "gbd"]);
    expect(setSourceEnabled(["gbd", "guidelines"], "gbd", true)).toEqual(["guidelines"]);
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type Question, questionSetSchema } from "./question-set";
import { buildRouterFixture, loincsOf, routerLabel, toolsOf } from "./router-labels";

const ROOT = join(import.meta.dir, "..", "..");

type Values = NonNullable<Question["expect"]["values"]>;

const item = (
  overrides: Readonly<{
    scenario?: Question["scenario"];
    mustCall?: Question["expect"]["tools"]["must_call"];
    values?: Values;
    measures?: string[];
  }>,
): Question => ({
  id: `Q-${overrides.scenario ?? "S1"}-01`,
  scenario: overrides.scenario ?? "S1",
  criteria: ["correctness"],
  question: "A synthetic question for the label test.",
  context: { data_mode: "synthetic", corpora: ["warehouse"] },
  expect: {
    answer_class: "analytics",
    sufficient_data: true,
    abstained: false,
    uncertainty: { level: "low", reasons: [] },
    next_step: "none",
    interpretation_kind: "narration",
    tools: { must_call: overrides.mustCall ?? [], must_not_call: [] },
    ...(overrides.values ? { values: overrides.values } : {}),
    ...(overrides.measures ? { measures: overrides.measures } : {}),
    must_not: ["a number that no tool returned"],
  },
  repeat: 1,
  human: "Plain words.",
});

const value = (
  tool: Values[number]["tool"],
  args: Record<string, unknown>,
): Values[number] => ({
  name: "n",
  tool,
  args,
  path: "n",
  unit: null,
  tolerance: { exact: true },
});

describe("toolsOf and loincsOf", () => {
  test("tools come from must_call and keyed values, once each", () => {
    expect(
      toolsOf(
        item({
          mustCall: ["trend"],
          values: [value("trend", {}), value("sleep_summary", {})],
        }),
      ),
    ).toEqual(["trend", "sleep_summary"]);
  });

  test("codes come from one code, a list of codes and measures, and only LOINC codes", () => {
    expect(
      loincsOf(
        item({
          values: [
            value("trend", { loinc: "4548-4" }),
            value("coverage", { loinc: ["2339-0", "4548-4"] }),
          ],
          measures: ["17856-6", "sleep score"],
        }),
      ),
    ).toEqual(["4548-4", "2339-0", "17856-6"]);
  });
});

describe("routerLabel", () => {
  test("guideline, population and medicine or dose decision scenarios go to the General Practitioner", () => {
    expect(routerLabel(item({ scenario: "S3" })).expected).toBe("gp");
    expect(routerLabel(item({ scenario: "S4" })).expected).toBe("gp");
    expect(
      routerLabel(item({ scenario: "S5", values: [value("trend", { loinc: "4548-4" })] }))
        .expected,
    ).toBe("gp");
  });

  test("wearable tools name Sleep or Trainer", () => {
    expect(routerLabel(item({ mustCall: ["sleep_summary"] }))).toEqual({
      expected: "sleep",
      rule: "tool sleep_summary",
    });
    expect(routerLabel(item({ values: [value("training_load", {})] }))).toEqual({
      expected: "trainer",
      rule: "tool training_load",
    });
    expect(routerLabel(item({ mustCall: ["hrv_trend"] })).expected).toBe("trainer");
    expect(routerLabel(item({ mustCall: ["resting_hr_trend"] })).expected).toBe(
      "trainer",
    );
  });

  test("only Diet measures name the Diet specialist; any other code keeps the General Practitioner", () => {
    expect(routerLabel(item({ values: [value("trend", { loinc: "29463-7" })] }))).toEqual(
      {
        expected: "diet",
        rule: "LOINC 29463-7: all Diet measures",
      },
    );
    expect(
      routerLabel(item({ values: [value("coverage", { loinc: ["2339-0", "2947-0"] })] }))
        .expected,
    ).toBe("gp");
    expect(
      routerLabel(item({ values: [value("trend", { loinc: "8480-6" })] })).expected,
    ).toBe("gp");
  });

  test("nothing to go on: the General Practitioner", () => {
    expect(routerLabel(item({}))).toEqual({
      expected: "gp",
      rule: "no specialist tool and no LOINC code",
    });
  });
});

describe("evaluation/agent-router.questions.v1.json", () => {
  test("is what the rules give for evaluation/questions.v1.json today", () => {
    const set = questionSetSchema.parse(
      JSON.parse(readFileSync(join(ROOT, "evaluation", "questions.v1.json"), "utf8")),
    );
    const committed: unknown = JSON.parse(
      readFileSync(join(ROOT, "evaluation", "agent-router.questions.v1.json"), "utf8"),
    );
    expect(committed).toEqual(buildRouterFixture(set.items));
  });
});

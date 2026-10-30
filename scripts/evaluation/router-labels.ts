/**
 * The agent each scored question should go to, for the Auto router's second
 * fixture (#219). The label comes from what the item already declares (its
 * scenario, the tools it must call or is keyed on, and its LOINC codes), never
 * from the question's words, so the router's keyword rules are measured against
 * something they did not write. First rule that applies wins.
 *
 *   bun run eval:router-fixture
 *
 * rewrites `evaluation/agent-router.questions.v1.json` from
 * `evaluation/questions.v1.json`; docs/agents.md lists the rules.
 */
import type { Question } from "./question-set";

export type RouterLabel = Readonly<{ expected: string; rule: string }>;

/**
 * The Diet specialist's measures, as `/nutrition` lists them, plus the two
 * codes the question set accepts for the same analyte (serum glucose, HbA1c
 * by HPLC).
 */
export const DIET_LOINCS: ReadonlySet<string> = new Set([
  "29463-7", // body weight
  "39156-5", // BMI
  "2339-0", // glucose
  "2345-7", // glucose, serum or plasma
  "4548-4", // HbA1c
  "17856-6", // HbA1c by HPLC
  "2093-3", // total cholesterol
  "18262-6", // LDL cholesterol
  "2085-9", // HDL cholesterol
  "2571-8", // triglycerides
]);

const SLEEP_TOOLS: ReadonlySet<string> = new Set(["sleep_summary"]);
const TRAINER_TOOLS: ReadonlySet<string> = new Set([
  "hrv_trend",
  "resting_hr_trend",
  "training_load",
]);
const GENOME_TOOLS: ReadonlySet<string> = new Set(["genome_report", "dna_ask"]);

const LOINC = /^\d{1,7}-\d$/;

/** Tools the item must call or is keyed on. */
export const toolsOf = (item: Question): readonly string[] => [
  ...new Set([
    ...item.expect.tools.must_call,
    ...(item.expect.values ?? []).map(({ tool }) => tool),
  ]),
];

const asCodes = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [value];

/** LOINC codes in the item's keyed arguments (one or a list) and its declared measures. */
export const loincsOf = (item: Question): readonly string[] => [
  ...new Set(
    [
      ...(item.expect.values ?? []).flatMap(({ args }) => asCodes(args["loinc"])),
      ...(item.expect.measures ?? []),
    ].filter((code): code is string => typeof code === "string" && LOINC.test(code)),
  ),
];

const SCENARIO_RULES: Readonly<Record<string, string>> = {
  S3: "S3: a guideline library question goes to the General agent",
  S4: "S4: a population (GBD) question goes to the General agent",
  S5: "S5: a medicine or dose decision to decline goes to the General agent",
};

export const routerLabel = (item: Question): RouterLabel => {
  const scenarioRule = SCENARIO_RULES[item.scenario];
  if (scenarioRule !== undefined) return { expected: "gp", rule: scenarioRule };

  const tools = toolsOf(item);
  const hasTool = (set: ReadonlySet<string>): string | undefined =>
    tools.find((tool) => set.has(tool));

  const genome = hasTool(GENOME_TOOLS);
  if (genome !== undefined) return { expected: "genetics", rule: `tool ${genome}` };
  const sleep = hasTool(SLEEP_TOOLS);
  if (sleep !== undefined) return { expected: "sleep", rule: `tool ${sleep}` };
  const trainer = hasTool(TRAINER_TOOLS);
  if (trainer !== undefined) return { expected: "trainer", rule: `tool ${trainer}` };

  const loincs = loincsOf(item);
  if (loincs.length > 0 && loincs.every((code) => DIET_LOINCS.has(code))) {
    return { expected: "diet", rule: `LOINC ${loincs.join(", ")}: all Diet measures` };
  }
  return loincs.length > 0
    ? { expected: "gp", rule: `LOINC ${loincs.join(", ")}: not only Diet measures` }
    : { expected: "gp", rule: "no specialist tool and no LOINC code" };
};

export type RouterFixtureItem = Readonly<{
  id: string;
  prompt: string;
  expected: string;
  rule: string;
}>;

export type RouterFixture = Readonly<{
  schema_version: 1;
  description: string;
  source: string;
  items: readonly RouterFixtureItem[];
}>;

export const ROUTER_FIXTURE_SOURCE = "evaluation/questions.v1.json";

export const buildRouterFixture = (items: readonly Question[]): RouterFixture => ({
  schema_version: 1,
  description:
    "Router fixture for Auto mode (#219) built from the scored question set. Each label comes from the item's scenario, tools and LOINC codes (scripts/evaluation/router-labels.ts), not from its words. Rebuild with bun run eval:router-fixture.",
  source: ROUTER_FIXTURE_SOURCE,
  items: items.map((item) => ({
    id: item.id,
    prompt: item.question,
    ...routerLabel(item),
  })),
});

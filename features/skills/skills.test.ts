import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { parseSkillFile } from "./frontmatter";
import { checkSkills, readSyntheticSubjects } from "./read-skills";
import { runSkillEvals } from "./run-skill-evals";
import { type SkillFiles, validateSkill } from "./validate-skill";

const ROOT = join(import.meta.dir, "..", "..");
const SUBJECT = "9661a432-4630-2cd9-142c-386845fae837";
const SUBJECTS: ReadonlySet<string> = new Set([SUBJECT]);

const skillMd = (front: string, body = "Describe the data.") =>
  `---\n${front}\n---\n\n${body}\n`;

const BASE_FRONT = [
  "name: demo",
  "description: A demo skill",
  "tools: [summary_stats]",
  "sources: [cohort-records]",
].join("\n");

const statsStep = {
  tool: "summary_stats",
  input: {
    subject_ref: SUBJECT,
    loinc: "93832-4",
    start: "2025-10-01",
    end: "2025-10-30",
  },
};

const evalFile = (body: Record<string, unknown>, file = "case-one.json") => ({
  file,
  text: JSON.stringify({ question: "How was it?", ...body }),
});

const files = (front: string, evals: SkillFiles["evals"]): SkillFiles => ({
  folder: "demo",
  skillMd: skillMd(front),
  evals,
});

const okEval = evalFile({
  script: [statsStep],
  expect: { calls: ["summary_stats"], refusals: [] },
});

describe("skills/ in this repository", () => {
  test("every skill is valid and every eval case passes", () => {
    const check = checkSkills(
      join(ROOT, "skills"),
      readSyntheticSubjects(join(ROOT, "evaluation", "questions.v1.json")),
    );
    expect(check.errors).toEqual([]);
    expect(check.results.filter((result) => !result.passed)).toEqual([]);
    expect(check.skills).toContain("sleep");
    expect(check.results.filter((result) => result.skill === "sleep").length).toBe(8);
  });
});

describe("parseSkillFile", () => {
  test("reads scalars, quoted values, lists and the body", () => {
    expect(
      parseSkillFile(
        '---\nname: demo\ndescription: "a: b"\ntools: [x, y]\nviews: []\n---\nBody',
      ),
    ).toEqual({
      ok: true,
      value: {
        fields: { name: "demo", description: "a: b", tools: ["x", "y"], views: [] },
        body: "Body",
      },
    });
  });

  test("names the line it cannot read", () => {
    expect(parseSkillFile("---\nname: demo\n- loose\n---\n")).toEqual({
      ok: false,
      error: 'line 3: expected "key: value", got "- loose"',
    });
    expect(parseSkillFile("---\ntools:\n  - a\n  b\n---\n")).toEqual({
      ok: false,
      error: 'line 4: expected "- item" under "tools"',
    });
  });

  test("reads block lists and lists wrapped onto the next line", () => {
    expect(
      parseSkillFile("---\ntools:\n  - a\n  - 'b'\nviews:\n  [c,\n  d]\n---\nBody"),
    ).toEqual({
      ok: true,
      value: { fields: { tools: ["a", "b"], views: ["c", "d"] }, body: "Body" },
    });
  });

  test("rejects a missing closing line and duplicate keys", () => {
    expect(parseSkillFile("---\nname: demo\n")).toEqual({
      ok: false,
      error: "frontmatter has no closing --- line",
    });
    expect(parseSkillFile("---\nname: a\nname: b\n---\n")).toEqual({
      ok: false,
      error: '"name" appears more than once',
    });
  });
});

describe("validateSkill", () => {
  test("providers default to local only, views to none", () => {
    const result = validateSkill(files(BASE_FRONT, [okEval]), SUBJECTS);
    expect(result.ok && result.skill.providers).toEqual(["ollama"]);
    expect(result.ok && result.skill.views).toEqual([]);
    expect(result.ok && result.skill.evals.map((evalCase) => evalCase.id)).toEqual([
      "case-one",
    ]);
  });

  test("an unknown tool, a tool without its source and an unknown key are errors", () => {
    const front = [
      "name: demo",
      "description: A demo skill",
      "tools: [trend, made_up]",
      "sources: [cohort-records]",
      "model: big",
    ].join("\n");
    const result = validateSkill(files(front, [okEval]), SUBJECTS);
    expect(result.ok ? [] : result.errors).toEqual([
      'skills/demo/SKILL.md: tools.1: unknown tool "made_up"; known tools: guideline_search, knowledge_search, list_subjects, subject_window, observations_for_subject, latest_by_loinc, summary_stats, trend, baseline_deviation, coverage, compare_windows, gbd_population',
      'skills/demo/SKILL.md: Unrecognized key: "model"',
      'skills/demo/SKILL.md: tools.0: tool "trend" needs source "cohort-analytics" in sources',
    ]);
  });

  test("a source that needs another source is an error", () => {
    const front = [
      "name: demo",
      "description: A demo skill",
      "tools: [trend]",
      "sources: [cohort-analytics]",
    ].join("\n");
    const result = validateSkill(files(front, [okEval]), SUBJECTS);
    expect(result.ok ? [] : result.errors).toEqual([
      'skills/demo/SKILL.md: sources.0: source "cohort-analytics" needs source "cohort-records" in sources',
    ]);
  });

  test("a skill reading wearable context cannot list a synthetic-only provider", () => {
    const front = `${BASE_FRONT}\n`.replace(
      "sources: [cohort-records]",
      "sources: [cohort-records, wearable-context]\nproviders: [ollama, exoscale, openrouter]",
    );
    const result = validateSkill(files(front, [okEval]), SUBJECTS);
    expect(result.ok ? [] : result.errors).toEqual([
      'skills/demo/SKILL.md: providers.2: provider "openrouter" may never receive personal data (infrastructure/data-mode-policy.ts), so a skill reading wearable-context cannot list it',
    ]);
  });

  test("name must match the folder, and a skill needs evals", () => {
    const result = validateSkill(
      { folder: "other", skillMd: skillMd(BASE_FRONT), evals: [] },
      SUBJECTS,
    );
    expect(result.ok ? [] : result.errors).toEqual([
      'skills/other/SKILL.md: name "demo" must match its folder "other"',
      "skills/other/evals: a skill needs at least one eval case",
    ]);
  });

  test("eval cases may only name synthetic subjects", () => {
    const real = evalFile({
      script: [{ ...statsStep, input: { ...statsStep.input, subject_ref: "someone" } }],
      expect: { calls: ["summary_stats"], refusals: [] },
    });
    const result = validateSkill(files(BASE_FRONT, [real]), SUBJECTS);
    expect(result.ok ? [] : result.errors).toEqual([
      'skills/demo/evals/case-one.json: subject_ref "someone" is not a synthetic subject from evaluation/questions.v1.json',
    ]);
  });
});

describe("runSkillEvals", () => {
  const run = (front: string, body: Record<string, unknown>) => {
    const result = validateSkill(files(front, [evalFile(body)]), SUBJECTS);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    return runSkillEvals(result.skill);
  };

  test("a case whose expectation does not match fails", () => {
    const [result] = run(BASE_FRONT, {
      script: [statsStep],
      expect: { calls: [], refusals: [] },
    });
    expect(result?.passed).toBe(false);
    expect(result?.actual).toEqual({ calls: ["summary_stats"], views: [], refusals: [] });
  });

  test("the data-mode policy still applies to a provider the skill allows", () => {
    const front = `${BASE_FRONT}\nproviders: [ollama, exoscale]`;
    const body = {
      provider: "exoscale",
      dataMode: "personal",
      script: [statsStep],
      expect: { calls: [], refusals: ["provider-not-permitted-for-data-mode"] },
    };
    expect(run(front, body).map((result) => result.passed)).toEqual([true]);
    expect(
      run(front, {
        ...body,
        exoscalePersonalData: "consented-pilot",
        expect: { calls: ["summary_stats"], refusals: [] },
      }).map((result) => result.passed),
    ).toEqual([true]);
  });

  test("wearable context needs the wearable-context source", () => {
    const [result] = run(BASE_FRONT, {
      wearableContext: true,
      script: [statsStep],
      expect: { calls: [], refusals: ["source-not-allowed"] },
    });
    expect(result?.passed).toBe(true);
  });
});

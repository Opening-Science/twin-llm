import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runnableSkillsIn } from "./load-skills";

/**
 * Which skills the app offers: only folders that validate and whose eval
 * cases all pass. Built in a temporary folder with synthetic skills.
 */

const SUBJECT = "9661a432-4630-2cd9-142c-386845fae837";
const root = mkdtempSync(join(tmpdir(), "twin-skills-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const writeSkill = (
  name: string,
  front: string,
  evalCase: Record<string, unknown> | null,
): void => {
  mkdirSync(join(root, "skills", name, "evals"), { recursive: true });
  writeFileSync(
    join(root, "skills", name, "SKILL.md"),
    `---\n${front}\n---\n\nDescribe the data.\n`,
  );
  if (evalCase !== null) {
    writeFileSync(
      join(root, "skills", name, "evals", "case-one.json"),
      JSON.stringify({ question: "How was it?", ...evalCase }),
    );
  }
};

const statsStep = {
  tool: "summary_stats",
  input: {
    subject_ref: SUBJECT,
    loinc: "93832-4",
    start: "2025-10-01",
    end: "2025-10-30",
  },
};

writeFileSync(
  join(root, "questions.json"),
  JSON.stringify({ items: [{ subject_ref: SUBJECT }] }),
);
// Valid, and its case passes.
writeSkill(
  "good",
  "name: good\ndescription: A good skill\ntools: [summary_stats]\nsources: [cohort-records]",
  { script: [statsStep], expect: { calls: ["summary_stats"], refusals: [] } },
);
// Invalid frontmatter: a tool whose source is not listed.
writeSkill(
  "bad-format",
  "name: bad-format\ndescription: Broken\ntools: [trend]\nsources: [cohort-records]",
  { script: [], expect: { calls: [], refusals: [] } },
);
// Valid format, but its eval case expects a call the gate refuses.
writeSkill(
  "bad-eval",
  "name: bad-eval\ndescription: Fails its case\ntools: [coverage]\nsources: [cohort-records, cohort-analytics]",
  { script: [statsStep], expect: { calls: ["summary_stats"], refusals: [] } },
);
// No eval cases at all.
writeSkill(
  "no-evals",
  "name: no-evals\ndescription: Untested\ntools: [summary_stats]\nsources: [cohort-records]",
  null,
);

describe("runnableSkillsIn", () => {
  test("lists only skills that validate and pass every case, and logs the rest", () => {
    const logged = spyOn(console, "error").mockImplementation(() => undefined);
    const skills = runnableSkillsIn({
      skillsDir: join(root, "skills"),
      questionsPath: join(root, "questions.json"),
    });
    expect(skills.map((skill) => skill.name)).toEqual(["good"]);
    expect(skills[0]).toMatchObject({
      name: "good",
      description: "A good skill",
      tools: ["summary_stats"],
      sources: ["cohort-records"],
      providers: ["ollama"],
      views: [],
      instructions: "Describe the data.",
    });
    expect(logged.mock.calls.map((call) => String(call[0]))).toEqual([
      '[skills] skills/bad-format/SKILL.md: tools.0: tool "trend" needs source "cohort-analytics" in sources',
      "[skills] skills/no-evals/evals: a skill needs at least one eval case",
      "[skills] bad-eval: an eval case fails",
    ]);
    logged.mockRestore();
  });

  test("the repository's own skills/ offers its seven skills", () => {
    const repo = join(import.meta.dir, "..", "..");
    const skills = runnableSkillsIn({
      skillsDir: join(repo, "skills"),
      questionsPath: join(repo, "evaluation", "questions.v1.json"),
    });
    expect(skills.map((skill) => skill.name)).toEqual([
      "anatomy",
      "brain",
      "genome",
      "nutrition",
      "rhythm",
      "sleep",
      "trainer",
    ]);
    expect(skills.map((skill) => skill.providers)).toEqual([
      ["ollama"],
      ["ollama"],
      ["ollama"],
      ["ollama"],
      ["ollama"],
      ["ollama"],
      ["ollama"],
    ]);
    expect(skills[0]?.tools).toEqual(["knowledge_search"]);
    expect(skills[1]?.views).toEqual(["chart.timeseries"]);
    expect(skills[2]?.tools).toEqual(["genome_report", "dna_ask", "genome_variants"]);
    expect(skills[3]?.views).toEqual(["chart.timeseries", "biomarker.card"]);
    expect(skills[4]?.tools).toEqual([
      "subject_window",
      "hrv_trend",
      "resting_hr_trend",
      "conditions_timeline",
      "values_around_event",
      "knowledge_search",
    ]);
    expect(skills[5]?.views).toEqual(["chart.timeseries", "chart.compare"]);
    expect(skills[6]?.views).toEqual(["chart.timeseries"]);
  });
});

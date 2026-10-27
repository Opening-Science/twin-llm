import { describe, expect, test } from "bun:test";

import { checkUserSkill, type UserSkillRow, userTurnSkill } from "./user-skill";

const form = (
  overrides: Record<string, unknown> = {},
  instructions = "Chart my resting heart rate.",
) => ({
  frontmatter: {
    name: "resting-hr",
    description: "Resting heart rate over a month",
    tools: ["subject_window", "trend"],
    sources: ["cohort-records", "cohort-analytics"],
    ...overrides,
  },
  instructions,
});

const taken = new Set(["sleep", "genome", "connect", "twin"]);

describe("checkUserSkill", () => {
  test("a valid form passes with local-only providers by default", () => {
    const checked = checkUserSkill(form(), taken);
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.skill.frontmatter.providers).toEqual(["ollama"]);
      expect(checked.skill.frontmatter.views).toEqual([]);
    }
  });

  test("a shipped skill's or a command's name is refused", () => {
    expect(checkUserSkill(form({ name: "sleep" }), taken)).toEqual({
      ok: false,
      errors: { name: "a shipped skill or command already has this name" },
    });
  });

  test("a tool needs its source, as in a SKILL.md", () => {
    const checked = checkUserSkill(form({ sources: ["cohort-records"] }), taken);
    expect(checked.ok).toBe(false);
    if (!checked.ok)
      expect(checked.errors.tools).toContain('needs source "cohort-analytics"');
  });

  test("genome tools can never list a hosted provider", () => {
    const checked = checkUserSkill(
      form({
        tools: ["genome_report"],
        sources: ["ark-genome"],
        providers: ["ollama", "openrouter"],
      }),
      taken,
    );
    expect(checked.ok).toBe(false);
    if (!checked.ok)
      expect(checked.errors.providers).toContain("may never receive a genotype");
  });

  test("empty or overlong instructions, bad names and unknown fields are refused", () => {
    expect(checkUserSkill(form({}, "   "), taken).ok).toBe(false);
    expect(checkUserSkill(form({}, "x".repeat(4001)), taken).ok).toBe(false);
    expect(checkUserSkill(form({ name: "Resting HR" }), taken).ok).toBe(false);
    expect(checkUserSkill({ ...form(), extra: true }, taken).ok).toBe(false);
  });
});

describe("userTurnSkill", () => {
  const row: UserSkillRow = {
    id: "s1",
    name: "resting-hr",
    description: "Resting heart rate over a month",
    instructions: "Chart my resting heart rate.",
    tools: ["subject_window", "trend"],
    sources: ["cohort-records", "cohort-analytics"],
    providers: ["ollama"],
    views: [],
  };

  test("a stored row runs as a turn skill", () => {
    expect(userTurnSkill(row)).toEqual({
      name: "resting-hr",
      description: "Resting heart rate over a month",
      tools: ["subject_window", "trend"],
      sources: ["cohort-records", "cohort-analytics"],
      providers: ["ollama"],
      views: [],
      instructions: "Chart my resting heart rate.",
    });
  });

  test("a row that breaks today's rules does not run", () => {
    expect(userTurnSkill({ ...row, tools: ["made_up_tool"] })).toBeNull();
    expect(userTurnSkill({ ...row, sources: ["cohort-records"] })).toBeNull();
  });
});

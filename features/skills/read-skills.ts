import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { type CaseResult, runSkillEvals } from "./run-skill-evals";
import { type SkillFiles, validateSkill } from "./validate-skill";

/**
 * Reads skills/ from disk and checks every skill: the file format, then its
 * eval cases against the scripted model. Used by `bun run skills:check` and
 * by the unit tests, so a failing eval fails CI.
 */

export type SkillsCheck = Readonly<{
  skills: readonly string[];
  errors: readonly string[];
  results: readonly CaseResult[];
}>;

const readSkillFolder = (root: string, folder: string): SkillFiles => {
  const evalDir = join(root, folder, "evals");
  const evalFiles = existsSync(evalDir)
    ? readdirSync(evalDir)
        .filter((file) => !file.startsWith("."))
        .sort()
    : [];
  const skillPath = join(root, folder, "SKILL.md");
  return {
    folder,
    skillMd: existsSync(skillPath) ? readFileSync(skillPath, "utf8") : "",
    evals: evalFiles.map((file) => ({
      file,
      text: readFileSync(join(evalDir, file), "utf8"),
    })),
  };
};

/** Subject refs of the synthetic question set; eval cases may name only these. */
export const readSyntheticSubjects = (questionsPath: string): ReadonlySet<string> => {
  const raw = JSON.parse(readFileSync(questionsPath, "utf8")) as unknown;
  const items =
    typeof raw === "object" && raw !== null && "items" in raw && Array.isArray(raw.items)
      ? (raw.items as readonly unknown[])
      : [];
  return new Set(
    items.flatMap((item) =>
      typeof item === "object" &&
      item !== null &&
      "subject_ref" in item &&
      typeof item.subject_ref === "string"
        ? [item.subject_ref]
        : [],
    ),
  );
};

export const checkSkills = (
  root: string,
  syntheticSubjects: ReadonlySet<string>,
): SkillsCheck => {
  const folders = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const validated = folders.map((folder) =>
    validateSkill(readSkillFolder(root, folder), syntheticSubjects),
  );
  return {
    skills: folders,
    errors: validated.flatMap((result) => (result.ok ? [] : result.errors)),
    results: validated.flatMap((result) =>
      result.ok ? runSkillEvals(result.skill) : [],
    ),
  };
};

import { type z } from "zod";

import { parseSkillFile } from "./frontmatter";
import {
  type Skill,
  type SkillEvalCase,
  skillEvalCaseSchema,
  skillFrontmatterSchema,
} from "./skill-schema";

/**
 * Turns the raw files of one skill folder into a checked Skill, or a list of
 * errors that each name the file and field. Pure: the caller reads the files.
 */

export type SkillFiles = Readonly<{
  /** Folder name under skills/; must equal the frontmatter name. */
  folder: string;
  skillMd: string;
  evals: readonly Readonly<{ file: string; text: string }>[];
}>;

export type SkillValidation =
  | Readonly<{ ok: true; skill: Skill }>
  | Readonly<{ ok: false; errors: readonly string[] }>;

const EVAL_ID = /^([a-z0-9][a-z0-9-]*)\.json$/;

const issueLines = (where: string, error: z.ZodError): readonly string[] =>
  error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return `${where}: ${path === "" ? "" : `${path}: `}${issue.message}`;
  });

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const subjectRefs = (evalCase: SkillEvalCase): readonly string[] =>
  evalCase.script.flatMap((step) => {
    if (!("input" in step)) return [];
    const ref = step.input["subject_ref"];
    return typeof ref === "string" ? [ref] : [];
  });

type EvalResult =
  | Readonly<{ ok: true; value: SkillEvalCase }>
  | Readonly<{ ok: false; errors: readonly string[] }>;

const validateEval = (
  where: string,
  file: string,
  text: string,
  syntheticSubjects: ReadonlySet<string>,
): EvalResult => {
  const match = EVAL_ID.exec(file);
  if (match === null) {
    return {
      ok: false,
      errors: [`${where}: file name must be lower-case-with-dashes.json`],
    };
  }
  const json = parseJson(text);
  if (json === undefined) return { ok: false, errors: [`${where}: not valid JSON`] };
  const parsed = skillEvalCaseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, errors: issueLines(where, parsed.error) };
  const value = { ...parsed.data, id: match[1] ?? file };
  const unknown = subjectRefs(value).filter((ref) => !syntheticSubjects.has(ref));
  return unknown.length === 0
    ? { ok: true, value }
    : {
        ok: false,
        errors: unknown.map(
          (ref) =>
            `${where}: subject_ref "${ref}" is not a synthetic subject from evaluation/questions.v1.json`,
        ),
      };
};

export const validateSkill = (
  files: SkillFiles,
  syntheticSubjects: ReadonlySet<string>,
): SkillValidation => {
  const where = `skills/${files.folder}/SKILL.md`;
  const parsed = parseSkillFile(files.skillMd);
  if (!parsed.ok) return { ok: false, errors: [`${where}: ${parsed.error}`] };

  const frontmatter = skillFrontmatterSchema.safeParse(parsed.value.fields);
  const frontErrors = frontmatter.success ? [] : issueLines(where, frontmatter.error);
  const nameErrors =
    frontmatter.success && frontmatter.data.name !== files.folder
      ? [
          `${where}: name "${frontmatter.data.name}" must match its folder "${files.folder}"`,
        ]
      : [];
  const bodyErrors =
    parsed.value.body === ""
      ? [`${where}: instructions after the frontmatter are empty`]
      : [];

  const evals = files.evals.map((entry) =>
    validateEval(
      `skills/${files.folder}/evals/${entry.file}`,
      entry.file,
      entry.text,
      syntheticSubjects,
    ),
  );
  const evalErrors = evals.flatMap((result) => (result.ok ? [] : result.errors));
  const noEvals =
    files.evals.length === 0
      ? [`skills/${files.folder}/evals: a skill needs at least one eval case`]
      : [];

  const errors = [
    ...frontErrors,
    ...nameErrors,
    ...bodyErrors,
    ...noEvals,
    ...evalErrors,
  ];
  if (errors.length > 0 || !frontmatter.success) return { ok: false, errors };
  return {
    ok: true,
    skill: {
      ...frontmatter.data,
      instructions: parsed.value.body,
      evals: evals.flatMap((result) => (result.ok ? [result.value] : [])),
    },
  };
};

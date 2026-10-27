import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { EVAL_COHORT, FIXTURE_COHORT } from "./cohort-pins";
import { EVAL_COHORT_SUBJECTS } from "./eval-cohort-subjects";

const ROOT = join(import.meta.dir, "../..");

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** `Patient.id` of a fixture bundle: the warehouse's subject ref. */
const patientIdOf = (bundle: unknown): string | null => {
  const entries = (
    bundle as { entry?: { resource?: { resourceType?: string; id?: string } }[] }
  ).entry;
  return (
    entries?.find((entry) => entry.resource?.resourceType === "Patient")?.resource?.id ??
    null
  );
};

const fixtureSubjects = (): Readonly<Record<string, string | null>> => {
  const dir = join(ROOT, FIXTURE_COHORT.fhirDir);
  return Object.fromEntries(
    readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => [name, patientIdOf(readJson(join(dir, name)))]),
  );
};

/** Every `"subject_ref": "…"` in a committed evaluation file. */
const subjectRefsIn = (relative: string): readonly string[] => [
  ...new Set(
    [
      ...readFileSync(join(ROOT, relative), "utf8").matchAll(/"subject_ref": "([^"]+)"/g),
    ].map((match) => match[1] ?? ""),
  ),
];

/** The two refs the question set uses on purpose for a subject that does not exist. */
const ABSENT_ON_PURPOSE = ["00000000-0000-0000-0000-000000000000", "not-in-cohort-001"];

describe("the evaluation cohort's subject ids", () => {
  test("are the pinned cohort's 37 subjects, once each", () => {
    expect(EVAL_COHORT_SUBJECTS.length).toBe(EVAL_COHORT.subjectCount);
    expect(new Set(EVAL_COHORT_SUBJECTS).size).toBe(EVAL_COHORT.subjectCount);
    expect([...EVAL_COHORT_SUBJECTS].sort()).toEqual([...EVAL_COHORT_SUBJECTS]);
  });

  test("hold every subject the questions and the answer key name", () => {
    const outside = (file: string) =>
      subjectRefsIn(file)
        .filter((ref) => !EVAL_COHORT_SUBJECTS.includes(ref))
        .sort();
    expect(outside("evaluation/questions.v1.json")).toEqual(ABSENT_ON_PURPOSE);
    expect(outside("evaluation/answer-key.v1.json")).toEqual(ABSENT_ON_PURPOSE);
  });
});

describe("the trimmed fixtures and the evaluation cohort (#96)", () => {
  test("the three open-twin patients are evaluation-cohort people; bp-panel is not", () => {
    const subjects = fixtureSubjects();
    expect(subjects).toEqual({
      "bp-panel.json": "b1000000-0000-4000-8000-000000000001",
      "patient-1.json": "ba419d35-0dfe-8af7-347c-eebf02485a56",
      "patient-2.json": "4f083ce3-f12b-bb4b-7353-e17f0cd55b0a",
      "patient-3.json": "aee7bbe1-0c45-c028-1e62-1f4cdb30c273",
    });
    // A subject belongs to one cohort, so these three would be rejected
    // (subject-cohort-conflict) by whichever cohort is ingested second.
    // setup:local deletes the fixture cohort before it loads the evaluation
    // cohort (plan.test.ts); if the fixtures are replaced by people outside
    // the cohort, this list becomes empty and that step can go.
    expect(
      Object.entries(subjects)
        .filter(([, id]) => id !== null && EVAL_COHORT_SUBJECTS.includes(id))
        .map(([name]) => name),
    ).toEqual(["patient-1.json", "patient-2.json", "patient-3.json"]);
  });
});

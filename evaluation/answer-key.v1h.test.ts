/**
 * Checks for the held-out S1 to S6 set v1h (#304): `questions.v1h.v1.json` is
 * exactly what the seeded rule in `scripts/evaluation/heldout-v1h.ts` gives
 * for the committed subject table and the guideline catalogue, and
 * `answer-key.v1h.v1.json` was built from those items by the query tools over
 * the evaluation cohort's patient files (`bun run eval:answer-key:v1h --
 * --cohort-dir .synthea`).
 *
 * Offline: the questions are the rule's output; they are third person and
 * pass the claim lint; the key names the pinned cohort and these questions;
 * every value has its entry; the probes key what a probe should get (no
 * reading, or the out-of-scope refusal). With RUN_LIVE=1 and V1H_COHORT_DIR
 * at the folder holding `fhir/`, the key and the subject table are rebuilt
 * from the files and must match:
 *
 *   RUN_LIVE=1 V1H_COHORT_DIR=.synthea bun test evaluation/answer-key.v1h.test.ts
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { GUIDELINE_MANIFEST } from "../packages/guidelines/manifest";
import {
  buildAnswerKey,
  cohortFilePorts,
  questionsSha256,
} from "../scripts/evaluation/build-answer-key";
import {
  absentLoincsOf,
  generateV1hSet,
  heldoutV1hSubjectFrom,
  V1H_SEED,
  v1hSubjectsSchema,
} from "../scripts/evaluation/heldout-v1h";
import {
  answerKeySchema,
  COHORT_ID,
  type KeyEntry,
  questionSetSchema,
} from "../scripts/evaluation/question-set";
import { BANNED_TERMS } from "../scripts/lint-claims";
import { EVAL_CONTENT_SHA256 } from "../scripts/synthea/cohort-presets";

const readText = (name: string): string =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

const rawQuestions = JSON.parse(readText("./questions.v1h.v1.json")) as unknown;
const set = questionSetSchema.parse(rawQuestions);
const key = answerKeySchema.parse(
  JSON.parse(readText("./answer-key.v1h.v1.json")) as unknown,
);
const table = v1hSubjectsSchema.parse(
  JSON.parse(readText("./heldout-v1h.subjects.json")) as unknown,
);
const catalogue = GUIDELINE_MANIFEST.map((entry) => ({
  id: entry.id,
  title: entry.title,
}));
const items = set.items;
const entriesOf = (id: string): readonly KeyEntry[] => key.entries[id] ?? [];
const tagged = (tag: string) => items.filter((item) => item.tags?.includes(tag));

describe("questions.v1h.v1.json", () => {
  test("is the seeded rule's output for the committed subject table", () => {
    expect(rawQuestions).toEqual(
      JSON.parse(
        JSON.stringify(generateV1hSet(V1H_SEED, { table, catalogue })),
      ) as unknown,
    );
    expect(set.cohort_id).toBe(COHORT_ID);
    expect(items.length).toBe(32);
  });

  test("questions are third person and pass the claim lint stems", () => {
    const texts = items.flatMap((item) => [
      item.question,
      item.human,
      ...item.expect.must_not,
    ]);
    const hits = texts.flatMap((text) =>
      BANNED_TERMS.filter((term) => new RegExp(term.source, "i").test(text)).map(
        (term) => `${term.id}: ${text}`,
      ),
    );
    expect(hits).toEqual([]);
    expect(items.filter((item) => /\b(you|your|my|me)\b/i.test(item.question))).toEqual(
      [],
    );
  });

  test("a subject named in the question is the item's subject_ref", () => {
    const named = items.filter((item) => item.subject_ref !== undefined);
    expect(
      named.filter((item) => !item.question.includes(item.subject_ref ?? "")),
    ).toEqual([]);
  });
});

describe("answer-key.v1h.v1.json", () => {
  test("was built from these questions and the pinned evaluation cohort", () => {
    expect(key.questions_sha256).toBe(questionsSha256(rawQuestions));
    expect(key.cohort.id).toBe(COHORT_ID);
    expect(key.cohort.subjects).toBe(table.subjects.length);
    expect(key.cohort.content_sha256).toBe(EVAL_CONTENT_SHA256);
  });

  test("every value has a key entry with the same call, and nothing else", () => {
    const asked = items.flatMap((item) =>
      (item.expect.values ?? []).map((spec) => {
        const entry = entriesOf(item.id).find(
          (candidate) => candidate.name === spec.name,
        );
        return entry !== undefined &&
          entry.tool === spec.tool &&
          entry.path === spec.path &&
          JSON.stringify(entry.args) === JSON.stringify(spec.args)
          ? null
          : `${item.id} ${spec.name}`;
      }),
    );
    expect(asked.filter((name) => name !== null)).toEqual([]);
    expect(Object.keys(key.entries).sort()).toEqual(
      items
        .filter((item) => (item.expect.values ?? []).length > 0)
        .map((item) => item.id)
        .sort(),
    );
    const all = Object.values(key.entries).flat();
    expect([Object.keys(key.entries).length, all.length]).toEqual([22, 75]);
  });

  test("answerable items key numbers with readings behind them; no refusal, no null", () => {
    const answerable = items.filter((item) => item.expect.answer_class === "analytics");
    const bad = answerable.flatMap((item) =>
      entriesOf(item.id)
        .filter(
          (entry) => entry.refusal !== null || entry.value === null || entry.n === 0,
        )
        .map((entry) => `${item.id} ${entry.name}`),
    );
    expect(answerable.length).toBe(17);
    expect(bad).toEqual([]);
  });

  test("probes key no reading, or the out-of-scope refusal for a ref outside the cohort", () => {
    const noReading = [
      ...tagged("absent-loinc-probe"),
      ...tagged("outside-record-probe"),
    ];
    expect(
      noReading.flatMap((item) => entriesOf(item.id).map((entry) => entry.value)),
    ).toEqual([0, 0, 0]);
    expect(
      tagged("out-of-cohort-probe").flatMap((item) =>
        entriesOf(item.id).map((entry) => entry.refusal),
      ),
    ).toEqual(["SUBJECT_SCOPE_VIOLATION", "SUBJECT_SCOPE_VIOLATION"]);
  });
});

// RUN_LIVE and V1H_COHORT_DIR are test-runner switches, not app config, read
// here as evaluation/answer-key.s7h.test.ts reads its own.
const runLive = Reflect.get(process.env, "RUN_LIVE") === "1";
const cohortDir = Reflect.get(process.env, "V1H_COHORT_DIR");

describe.skipIf(!runLive || typeof cohortDir !== "string")(
  "v1h key against the cohort files (RUN_LIVE=1, V1H_COHORT_DIR)",
  () => {
    test("a fresh build over the cohort gives the committed key", async () => {
      const fresh = await buildAnswerKey(
        rawQuestions,
        await cohortFilePorts(String(cohortDir), key.generated_on, COHORT_ID),
      );
      expect(fresh).toEqual(key);
    }, 120_000);

    test("the subject table is what the records hold", async () => {
      const { cohortSubjectFrom, loadCohortBundles } =
        await import("../scripts/evaluation/cohort-ports");
      const cohort = (await loadCohortBundles(`${String(cohortDir)}/fhir`)).flatMap(
        (bundle) => {
          const subject = cohortSubjectFrom(bundle, COHORT_ID, "v4.0.0");
          return subject === null ? [] : [subject];
        },
      );
      const subjects = cohort
        .flatMap((subject) => {
          const facts = heldoutV1hSubjectFrom(subject);
          return facts === null ? [] : [facts];
        })
        .sort((a, b) => (a.subject_ref < b.subject_ref ? -1 : 1));
      expect(subjects).toEqual(table.subjects);
      expect(absentLoincsOf(cohort)).toEqual(table.absent_loincs);
    }, 120_000);
  },
);

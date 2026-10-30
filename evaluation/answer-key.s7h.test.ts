/**
 * Checks for the held-out S7h set (#283): `questions.s7h.v1.json` is exactly
 * what the seeded rule in `scripts/evaluation/heldout-s7h.ts` gives for the
 * committed subject table, and `answer-key.s7h.v1.json` was built from those
 * items by the tools over the supplementary cohort `synthea-v4-s7`.
 *
 * Offline: the questions are the rule's output, byte for byte; the key names
 * the cohort the manifest pins; every `rhythm_irregularity` value is
 * recomputed from the pure tool function; each decline has its answerable
 * control; and no question or tool output carries the simulator's ground
 * truth. With RUN_LIVE=1 and S7_COHORT_DIR at the cohort folder the whole key
 * and the subject table are rebuilt from the files and must match:
 *
 *   RUN_LIVE=1 S7_COHORT_DIR=.synthea/synthea-v4-s7 bun test evaluation/answer-key.s7h.test.ts
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { rhythmGroundTruth } from "../packages/query-tools/rhythm-recording";
import { describeRecording } from "../packages/query-tools/rhythm-tools";
import {
  buildAnswerKey,
  cohortFilePorts,
  questionsSha256,
} from "../scripts/evaluation/build-answer-key";
import {
  afOnDayByRecord,
  generateHeldoutSet,
  type HeldoutSubject,
  heldoutSubjectFrom,
  heldoutSubjectsSchema,
  S7H_SEED,
} from "../scripts/evaluation/heldout-s7h";
import {
  answerKeySchema,
  type KeyEntry,
  questionSetSchema,
  readPath,
} from "../scripts/evaluation/question-set";
import { BANNED_TERMS } from "../scripts/lint-claims";
import { s7ManifestSchema, S7_MANIFEST_PATH } from "../scripts/synthea/s7-cohort";

const readText = (name: string): string =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

const rawQuestions = JSON.parse(readText("./questions.s7h.v1.json")) as unknown;
const keyText = readText("./answer-key.s7h.v1.json");
const set = questionSetSchema.parse(rawQuestions);
const key = answerKeySchema.parse(JSON.parse(keyText) as unknown);
const table = heldoutSubjectsSchema.parse(
  JSON.parse(readText("./heldout-s7h.subjects.json")) as unknown,
);
const manifest = s7ManifestSchema.parse(
  JSON.parse(readText(`../${S7_MANIFEST_PATH}`)) as unknown,
);
const items = set.items;
const entriesOf = (id: string): readonly KeyEntry[] => key.entries[id] ?? [];

const subjectOf = (ref: string): HeldoutSubject => {
  const found = table.subjects.find((subject) => subject.subject_ref === ref);
  if (found === undefined) throw new Error(`no subject ${ref}`);
  return found;
};

type RhythmArgs = Readonly<{
  subject_ref: string;
  recording: number;
  duration_sec: number;
  date: string;
}>;

const planOf = (args: RhythmArgs) => ({
  subjectRef: args.subject_ref,
  recording: args.recording,
  durationSec: args.duration_sec,
  date: args.date,
  afConditionActive: afOnDayByRecord(subjectOf(args.subject_ref), args.date),
});

const rhythmEntries = Object.values(key.entries)
  .flat()
  .filter((entry) => entry.tool === "rhythm_irregularity");
const argsOf = (entry: KeyEntry): RhythmArgs => entry.args as RhythmArgs;

describe("questions.s7h.v1.json", () => {
  test("is the seeded rule's output for the committed subject table", () => {
    expect(rawQuestions).toEqual(
      JSON.parse(JSON.stringify(generateHeldoutSet(S7H_SEED, table))) as unknown,
    );
    expect(set.cohort_id).toBe("synthea-v4-s7");
    expect(items.length).toBe(40);
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
    expect(items.filter((item) => /\b(you|your)\b/i.test(item.question))).toEqual([]);
  });

  test("every decline has an answerable control on the same subject, keyed without a refusal", () => {
    const declines = items.filter((item) => item.tags?.includes("rhythm-decline"));
    const unpaired = declines.filter((declined) => {
      const tag = declined.tags?.find((each) => each.startsWith("pair-"));
      const controls = items.filter(
        (item) =>
          item !== declined && tag !== undefined && item.tags?.includes(tag) === true,
      );
      const [control] = controls;
      return (
        controls.length !== 1 ||
        control === undefined ||
        control.subject_ref !== declined.subject_ref ||
        control.expect.answer_class !== "analytics" ||
        entriesOf(control.id).length === 0 ||
        entriesOf(control.id).some((entry) => entry.refusal !== null)
      );
    });
    expect(declines.length).toBe(8);
    expect(unpaired.map((item) => item.id)).toEqual([]);
  });
});

describe("no ground truth where a model could see it", () => {
  const TRUTH_WORDS =
    /fibrillation|\baf\b|sinus|paroxysm|episode|ectopic|premature|\bpac\b|\bpvc\b|ground truth|profile/i;

  test("rhythm questions that are not declines name no rhythm or condition", () => {
    const leaky = items
      .filter(
        (item) =>
          !item.tags?.includes("rhythm-decline") &&
          item.expect.values?.some((value) => value.tool === "rhythm_irregularity") ===
            true,
      )
      .filter((item) => TRUTH_WORDS.test(item.question))
      .map((item) => item.id);
    expect(leaky).toEqual([]);
  });

  test("no question asserts that a subject has a condition", () => {
    expect(
      items
        .filter((item) =>
          /\b(has|had|with) (atrial fibrillation|a stroke|dementia|alzheimer)/i.test(
            item.question,
          ),
        )
        .map((item) => item.id),
    ).toEqual([]);
  });

  test("no tool output, keyed path or key field holds simulator truth", () => {
    const sample = rhythmEntries[0];
    const truthFields =
      sample === undefined ? [] : Object.keys(rhythmGroundTruth(planOf(argsOf(sample))));
    expect(truthFields).toEqual([
      "profile",
      "afEpisodes",
      "afIntervalShare",
      "pac",
      "pvc",
    ]);
    const outputs = rhythmEntries.map((entry) =>
      JSON.stringify(describeRecording(planOf(argsOf(entry)))),
    );
    expect(
      outputs.filter((text) => truthFields.some((field) => text.includes(`"${field}"`))),
    ).toEqual([]);
    expect(truthFields.filter((field) => keyText.includes(`"${field}"`))).toEqual([]);
    expect(
      truthFields.filter((field) => JSON.stringify(rawQuestions).includes(`"${field}"`)),
    ).toEqual([]);
  });
});

describe("answer-key.s7h.v1.json", () => {
  test("was built from these questions and the pinned S7 cohort", () => {
    expect(key.questions_sha256).toBe(questionsSha256(rawQuestions));
    expect(key.cohort.id).toBe("synthea-v4-s7");
    expect(key.cohort.subjects).toBe(manifest.patientFileCount);
    expect(key.cohort.content_sha256).toBe(manifest.contentSha256);
  });

  test("every value has a key entry with the same call; none refused, none null", () => {
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
    const all = Object.values(key.entries).flat();
    expect(all.length).toBe(75);
    expect(Object.keys(key.entries).length).toBe(32);
    expect(all.filter((entry) => entry.refusal !== null || entry.value === null)).toEqual(
      [],
    );
  });

  test("every rhythm value is the tool's own output for that recording", () => {
    const differ = rhythmEntries.flatMap((entry) => {
      const result = describeRecording(planOf(argsOf(entry)));
      return readPath(result, entry.path) === entry.value &&
        readPath(result, "n") === entry.n
        ? []
        : [`${entry.name} ${JSON.stringify(entry.args)}`];
    });
    expect(rhythmEntries.length).toBe(55);
    expect(differ).toEqual([]);
  });

  test("recordings carry atrial fibrillation exactly on days the record lists it", () => {
    // Scorer side only: rhythmGroundTruth is never in a tool output or a question.
    const mismatched = rhythmEntries.filter((entry) => {
      const truth = rhythmGroundTruth(planOf(argsOf(entry)));
      return afOnDayByRecord(subjectOf(argsOf(entry).subject_ref), argsOf(entry).date)
        ? truth.profile !== "paroxysmal_af" || truth.afIntervalShare === 0
        : truth.profile !== "sinus" || truth.afIntervalShare !== 0;
    });
    expect(mismatched.map((entry) => entry.name)).toEqual([]);
  });
});

// RUN_LIVE and S7_COHORT_DIR are test-runner switches, not app config, read
// here as evaluation/answer-key.s7b.test.ts reads its own.
const runLive = Reflect.get(process.env, "RUN_LIVE") === "1";
const cohortDir = Reflect.get(process.env, "S7_COHORT_DIR");

describe.skipIf(!runLive || typeof cohortDir !== "string")(
  "S7h key against the cohort files (RUN_LIVE=1, S7_COHORT_DIR)",
  () => {
    test("a fresh build over the cohort gives the committed key", async () => {
      const fresh = await buildAnswerKey(
        rawQuestions,
        await cohortFilePorts(String(cohortDir), key.generated_on, "synthea-v4-s7"),
      );
      expect(fresh).toEqual(key);
    }, 120_000);

    test("the subject table is what the records hold", async () => {
      const { cohortSubjectFrom, loadCohortBundles } =
        await import("../scripts/evaluation/cohort-ports");
      const subjects = (await loadCohortBundles(`${String(cohortDir)}/fhir`))
        .flatMap((bundle) => {
          const subject = cohortSubjectFrom(bundle, "synthea-v4-s7", "v4.0.0");
          const facts = subject === null ? null : heldoutSubjectFrom(subject);
          return facts === null ? [] : [facts];
        })
        .sort((a, b) => (a.subject_ref < b.subject_ref ? -1 : 1));
      expect(subjects).toEqual(table.subjects);
    }, 120_000);
  },
);

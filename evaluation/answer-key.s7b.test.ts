/**
 * Drift and leak checks for the S7b set (#277): `questions.s7b.v1.json` and
 * `answer-key.s7b.v1.json`, keyed against the supplementary cohort
 * `synthea-v4-s7` (`scripts/synthea/s7-cohort.ts`).
 *
 * Offline: the files validate and agree; the key names the cohort the
 * committed manifest pins; every `rhythm_irregularity` value is recomputed
 * from the pure tool function (`describeRecording`); the simulator's ground
 * truth (`rhythmGroundTruth`, scorer side only) agrees with what each item was
 * written for; and nothing a model sees (the question) or a tool returns
 * carries that ground truth.
 *
 * With RUN_LIVE=1 and S7_COHORT_DIR at a folder holding the cohort's `fhir/`
 * (`bun run synthea:s7 -- load --archive <file>` puts it in
 * `.synthea/synthea-v4-s7`), the whole key is rebuilt through the tools over
 * those files and must equal the committed one, and the onset table below is
 * read back from the records:
 *
 *   RUN_LIVE=1 S7_COHORT_DIR=.synthea/synthea-v4-s7 bun test evaluation/answer-key.s7b.test.ts
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { rhythmGroundTruth } from "../packages/query-tools/rhythm-recording";
import { describeRecording } from "../packages/query-tools/rhythm-tools";
import { BANNED_TERMS } from "../scripts/lint-claims";
import {
  buildAnswerKey,
  cohortFilePorts,
  questionsSha256,
} from "../scripts/evaluation/build-answer-key";
import {
  answerKeySchema,
  CONSISTENCY_REPEAT,
  CRITERIA,
  type KeyEntry,
  LATENCY_SET_TAG,
  questionSetSchema,
  readPath,
} from "../scripts/evaluation/question-set";
import { s7ManifestSchema, S7_MANIFEST_PATH } from "../scripts/synthea/s7-cohort";

const readText = (name: string): string =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

const rawQuestions = JSON.parse(readText("./questions.s7b.v1.json")) as unknown;
const keyText = readText("./answer-key.s7b.v1.json");
const set = questionSetSchema.parse(rawQuestions);
const key = answerKeySchema.parse(JSON.parse(keyText) as unknown);
const manifest = s7ManifestSchema.parse(
  JSON.parse(readText(`../${S7_MANIFEST_PATH}`)) as unknown,
);
const items = set.items;
const entriesOf = (id: string): readonly KeyEntry[] => key.entries[id] ?? [];
const s7Questions = questionSetSchema.parse(
  JSON.parse(readText("./questions.s7.v1.json")) as unknown,
);

/**
 * The first recorded onset of atrial fibrillation (SNOMED CT 49436004) of each
 * subject in the cohort whose record has one; no record has an abatement.
 * Read from the cohort; the live check reads it again.
 */
const AF_ONSET: Readonly<Record<string, string>> = {
  "0ba5859a-a18a-b1a6-2b0b-50bb9425b036": "2021-05-12",
  "2539973f-31ed-cc8c-4de1-b0374d06d52a": "2024-12-08",
  "44d2905b-94a8-210d-1448-5cfc3c5c400a": "2019-06-11",
  "45e78959-6c40-73f8-d91b-5a08faff470c": "2019-08-05",
  "6cfebb99-dc56-e055-bb0b-5dc50c10d0cb": "2005-01-05",
  "70ba107a-37f1-9a96-f6c3-1bce08715cfb": "2022-04-14",
  "8ac1c852-d625-efe3-d7c8-fd267b34b731": "1995-03-19",
  "8e3e0cd7-9d26-5c89-f1ba-f3ae744dfd69": "1999-08-30",
  "90540a0e-ef0a-4348-7cf8-9fd9779fb54e": "2015-12-29",
  "afe8ca0b-5c31-742b-a760-b3f55d09ec74": "2018-01-23",
  "c0b3db8b-1e73-6d68-aadc-5e0914ff8a78": "1995-09-02",
  "cbb71edd-82ff-fb71-b250-1fee52a52f52": "2011-03-13",
  "f4f95c2d-a700-d464-8ff4-d48910b7b2b7": "2024-11-02",
};

/** The cohort's subjects without atrial fibrillation (the `sinus` run). */
const SINUS_SUBJECTS = [
  "2d68b88f-a1fc-829b-a57e-fe499c2313de",
  "988ba55d-a3c2-ca7d-c196-f6db45f22706",
  "e0242df3-9d0a-86ba-78d5-eaddf9b5eeb2",
  "f3510227-8dcf-8434-40ed-8cb9ad6b2f08",
];

const WEARABLE_SERIES_START = "2026-07-04";

type RhythmArgs = Readonly<{
  subject_ref: string;
  recording: number;
  duration_sec: number;
  date: string;
}>;

const afOnDay = (args: RhythmArgs): boolean => {
  const onset = AF_ONSET[args.subject_ref];
  return onset !== undefined && args.date >= onset;
};

const planOf = (args: RhythmArgs) => ({
  subjectRef: args.subject_ref,
  recording: args.recording,
  durationSec: args.duration_sec,
  date: args.date,
  afConditionActive: afOnDay(args),
});

const rhythmEntries = Object.values(key.entries)
  .flat()
  .filter((entry) => entry.tool === "rhythm_irregularity");
const answeredRhythm = rhythmEntries.filter((entry) => entry.refusal === null);
const argsOf = (entry: KeyEntry): RhythmArgs => entry.args as RhythmArgs;

describe("questions.s7b.v1.json", () => {
  test("34 S7 items numbered on from the S7 set", () => {
    expect(items.length).toBe(34);
    expect(items.every((item) => item.scenario === "S7")).toBe(true);
    const first = s7Questions.items.length + 1;
    expect(items.map((item) => item.id)).toEqual(
      items.map((_, index) => `Q-S7-${String(first + index).padStart(2, "0")}`),
    );
    expect(set.cohort_id).toBe("synthea-v4-s7");
  });

  test("criteria use the eight names, with consistency and latency items", () => {
    const used = new Set(items.flatMap((item) => item.criteria));
    expect([...used].sort()).toEqual([...CRITERIA].sort());
    const repeated = items.filter((item) => item.repeat > 1);
    expect(repeated.map((item) => [item.id, item.repeat])).toEqual([
      ["Q-S7-33", CONSISTENCY_REPEAT],
      ["Q-S7-64", CONSISTENCY_REPEAT],
    ]);
    expect(
      items.filter((item) => item.tags?.includes(LATENCY_SET_TAG)).map((item) => item.id),
    ).toEqual(["Q-S7-33"]);
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

  test("every item names one cohort subject, in its question", () => {
    const cohort = new Set([...Object.keys(AF_ONSET), ...SINUS_SUBJECTS]);
    expect(
      items
        .filter(
          (item) =>
            item.subject_ref === undefined ||
            !cohort.has(item.subject_ref) ||
            !item.question.includes(item.subject_ref),
        )
        .map((item) => item.id),
    ).toEqual([]);
  });

  test("the items cover more than one subject for each kind of question", () => {
    const subjectsTagged = (tag: string) =>
      new Set(
        items.filter((item) => item.tags?.includes(tag)).map((item) => item.subject_ref),
      ).size;
    expect(
      [
        "rhythm-metrics",
        "rhythm-compare",
        "rhythm-burden",
        "rhythm-refusal",
        "af-onset",
        "heart-brain",
        "rhythm-decline",
      ].map((tag) => [tag, subjectsTagged(tag)]),
    ).toEqual([
      ["rhythm-metrics", 6],
      ["rhythm-compare", 6],
      ["rhythm-burden", 5],
      ["rhythm-refusal", 1],
      ["af-onset", 4],
      ["heart-brain", 7],
      ["rhythm-decline", 3],
    ]);
    const named = new Set(items.map((item) => item.subject_ref));
    expect(Object.keys(AF_ONSET).filter((ref) => named.has(ref)).length).toBe(13);
    expect(SINUS_SUBJECTS.filter((ref) => named.has(ref)).length).toBe(4);
  });
});

describe("no ground truth where a model could see it", () => {
  const TRUTH_WORDS =
    /fibrillation|\baf\b|sinus|paroxysm|episode|ectopic|premature|\bpac\b|\bpvc\b|ground truth|profile/i;

  test("rhythm metric, burden, comparison and refusal questions name no rhythm or condition", () => {
    const leaky = items
      .filter((item) =>
        item.tags?.some((tag) =>
          [
            "rhythm-metrics",
            "rhythm-burden",
            "rhythm-compare",
            "rhythm-refusal",
          ].includes(tag),
        ),
      )
      .filter((item) => TRUTH_WORDS.test(item.question))
      .map((item) => item.id);
    expect(leaky).toEqual([]);
  });

  test("no question asserts that a subject has a condition", () => {
    const asserting = items
      .filter((item) =>
        /\b(has|had|with) (atrial fibrillation|a stroke|dementia|alzheimer)/i.test(
          item.question,
        ),
      )
      .map((item) => item.id);
    expect(asserting).toEqual([]);
  });

  test("no tool output or keyed path holds simulator truth", () => {
    const outputs = answeredRhythm.map((entry) =>
      JSON.stringify(describeRecording(planOf(argsOf(entry)))),
    );
    const sample = answeredRhythm[0];
    const truthFields =
      sample === undefined ? [] : Object.keys(rhythmGroundTruth(planOf(argsOf(sample))));
    expect(truthFields).toEqual([
      "profile",
      "afEpisodes",
      "afIntervalShare",
      "pac",
      "pvc",
    ]);
    expect(
      outputs.filter((text) => truthFields.some((field) => text.includes(`"${field}"`))),
    ).toEqual([]);
    expect(
      rhythmEntries.filter((entry) =>
        truthFields.some((field) => entry.path.includes(field)),
      ),
    ).toEqual([]);
    expect(truthFields.filter((field) => keyText.includes(`"${field}"`))).toEqual([]);
  });
});

describe("answer-key.s7b.v1.json", () => {
  test("was built from these questions and the pinned S7 cohort", () => {
    expect(key.questions_sha256).toBe(questionsSha256(rawQuestions));
    expect(key.cohort).toEqual({
      id: "synthea-v4-s7",
      synthea_version: manifest.syntheaVersion,
      seed: 2770,
      population: 17,
      age: manifest.age,
      reference_date: manifest.referenceDate,
      end_date: manifest.endDate,
      subjects: manifest.patientFileCount,
      content_sha256: manifest.contentSha256,
      runs: manifest.arms.map((arm) => ({
        name: arm.name,
        seed: arm.seed,
        clinician_seed: arm.clinicianSeed,
        population: arm.population,
      })),
    });
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
          entry.mode === spec.mode &&
          JSON.stringify(entry.args) === JSON.stringify(spec.args)
          ? null
          : `${item.id} ${spec.name}`;
      }),
    );
    expect(asked.filter((name) => name !== null)).toEqual([]);
    const count = items.reduce((sum, item) => sum + (item.expect.values?.length ?? 0), 0);
    expect(Object.values(key.entries).flat().length).toBe(count);
    expect(count).toBe(85);
  });

  test("refusals are keyed with their codes, and no value is null", () => {
    const refusals = Object.entries(key.entries)
      .flatMap(([id, entries]) =>
        entries
          .filter((entry) => entry.refusal !== null)
          .map((entry) => `${id} ${entry.refusal}`),
      )
      .sort();
    expect(refusals).toEqual([
      "Q-S7-50 OUTSIDE_SUBJECT_WINDOW",
      "Q-S7-54 NO_ROWS",
      "Q-S7-61 NO_ROWS",
      "Q-S7-62 NO_ROWS",
    ]);
    expect(
      Object.values(key.entries)
        .flat()
        .filter((entry) => entry.value === null),
    ).toEqual([]);
  });

  test("every rhythm value is the tool's own output for that recording", () => {
    const differ = answeredRhythm.flatMap((entry) => {
      const result = describeRecording(planOf(argsOf(entry)));
      return readPath(result, entry.path) === entry.value &&
        readPath(result, "n") === entry.n
        ? []
        : [`${entry.name} ${JSON.stringify(entry.args)}`];
    });
    expect(answeredRhythm.length).toBe(52);
    expect(differ).toEqual([]);
  });

  test("recordings on a day the record lists atrial fibrillation carry it; all others are sinus", () => {
    // Scorer side only: rhythmGroundTruth is never in a tool output or a question.
    const mismatched = answeredRhythm.filter((entry) => {
      const truth = rhythmGroundTruth(planOf(argsOf(entry)));
      return afOnDay(argsOf(entry))
        ? truth.profile !== "paroxysmal_af" || truth.afIntervalShare === 0
        : truth.profile !== "sinus" || truth.afIntervalShare !== 0;
    });
    expect(mismatched.map((entry) => entry.name)).toEqual([]);
    // Windows past the threshold appear only on days with atrial fibrillation in the record.
    const flaggedWithout = answeredRhythm.filter(
      (entry) =>
        entry.path === "n_flagged" &&
        !afOnDay(argsOf(entry)) &&
        typeof entry.value === "number" &&
        entry.value > 0,
    );
    expect(flaggedWithout).toEqual([]);
  });

  test("each comparison is one day before the onset and one after", () => {
    const compares = items.filter((item) => item.tags?.includes("rhythm-compare"));
    expect(
      compares.map((item) => entriesOf(item.id).map((entry) => afOnDay(argsOf(entry)))),
    ).toEqual(compares.map(() => [false, false, true, true]));
  });

  test("the condition order items read one onset per code", () => {
    expect(
      ["Q-S7-55", "Q-S7-56", "Q-S7-57"].map((id) =>
        entriesOf(id).map((entry) => [entry.name, entry.value]),
      ),
    ).toEqual([
      [
        ["atrial_fibrillation_n", 1],
        ["stroke_n", 1],
      ],
      [
        ["atrial_fibrillation_n", 1],
        ["stroke_n", 1],
      ],
      [
        ["atrial_fibrillation_n", 1],
        ["stroke_n", 1],
        ["alzheimers_n", 1],
      ],
    ]);
  });

  test("no window reaches the synthetic wearable series", () => {
    const late = Object.values(key.entries)
      .flat()
      .filter((entry) => {
        const args = entry.args as Record<string, unknown>;
        const ends = [args.end, args.date].filter(
          (value): value is string => typeof value === "string",
        );
        return ends.some((end) => end >= WEARABLE_SERIES_START);
      })
      .map((entry) => entry.name);
    expect(late).toEqual([]);
  });
});

// RUN_LIVE and S7_COHORT_DIR are test-runner switches, not app config, read
// here as evaluation/answer-key.s7.test.ts reads its own.
const runLive = Reflect.get(process.env, "RUN_LIVE") === "1";
const cohortDir = Reflect.get(process.env, "S7_COHORT_DIR");

describe.skipIf(!runLive || typeof cohortDir !== "string")(
  "S7b key against the cohort files (RUN_LIVE=1, S7_COHORT_DIR)",
  () => {
    test("a fresh build over the cohort gives the committed key", async () => {
      const fresh = await buildAnswerKey(
        rawQuestions,
        await cohortFilePorts(String(cohortDir), key.generated_on, "synthea-v4-s7"),
      );
      expect(fresh.cohort).toEqual(key.cohort);
      expect(fresh.open_twin_sha).toBe(key.open_twin_sha);
      expect(fresh.entries).toEqual(key.entries);
    }, 120_000);

    test("the onset table is what the records hold", async () => {
      const ports = await cohortFilePorts(
        String(cohortDir),
        key.generated_on,
        "synthea-v4-s7",
      );
      const onsets: Record<string, string> = {};
      for (const ref of [...Object.keys(AF_ONSET), ...SINUS_SUBJECTS]) {
        const result = await ports.runTool(
          "conditions_timeline",
          {
            subject_ref: ref,
            start: "1900-01-01T00:00:00Z",
            end: "2026-01-01T00:00:00Z",
            code: "49436004",
          },
          "synthetic",
        );
        const onset = readPath(result, "conditions.0.onset_at");
        if (typeof onset === "string") onsets[ref] = onset.slice(0, 10);
      }
      expect(onsets).toEqual({ ...AF_ONSET });
      expect(await ports.countSubjects()).toBe(17);
    }, 120_000);
  },
);

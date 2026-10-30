/**
 * Drift and leak checks for the S7 set (rhythm and heart-brain, #251):
 * `questions.s7.v1.json` and `answer-key.s7.v1.json`.
 *
 * Offline: the files validate and agree; every `rhythm_irregularity` value is
 * recomputed from the pure tool function (`describeRecording`), so the key is
 * the tool's output; the simulator's ground truth (`rhythmGroundTruth`, scorer
 * side only) agrees with what each item was written for; and nothing a model
 * sees (the question) or a tool returns carries that ground truth.
 *
 * With RUN_LIVE=1 and EVAL_COHORT_DIR at a folder holding the pinned cohort's
 * `fhir/` (unpacked from the eval-cohort-v1 release, never committed), the
 * whole key is rebuilt through the tools over those files and must equal the
 * committed one:
 *
 *   RUN_LIVE=1 EVAL_COHORT_DIR=<folder> bun test evaluation/answer-key.s7.test.ts
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { AppendInput } from "../packages/audit/append";
import type { QueryToolPorts } from "../packages/query-tools/ports";
import { rhythmGroundTruth } from "../packages/query-tools/rhythm-recording";
import { describeRecording } from "../packages/query-tools/rhythm-tools";
import { runRhythmIrregularity } from "../packages/query-tools/tools";
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
import { COHORT_PRESETS, EVAL_CONTENT_SHA256 } from "../scripts/synthea/cohort-presets";

const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8"));

const rawQuestions = readJson("./questions.s7.v1.json");
const keyText = readFileSync(
  fileURLToPath(new URL("./answer-key.s7.v1.json", import.meta.url)),
  "utf8",
);
const set = questionSetSchema.parse(rawQuestions);
const key = answerKeySchema.parse(JSON.parse(keyText) as unknown);
const items = set.items;
const entriesOf = (id: string): readonly KeyEntry[] => key.entries[id] ?? [];

/**
 * The cohort's one subject with atrial fibrillation (SNOMED CT 49436004),
 * onset 2012-06-12, no abatement recorded. Read from the pinned cohort; Q-S7-22
 * keys it through `conditions_timeline`, and the live check re-reads it.
 */
const AF_SUBJECT = "2d68ad16-268a-478c-1f84-d0f1976e1a46";
const AF_ONSET_DAY = "2012-06-12";

/** The synthetic wearable series starts here; no S7 window may reach it. */
const WEARABLE_SERIES_START = "2026-07-04";

type RhythmArgs = Readonly<{
  subject_ref: string;
  recording: number;
  duration_sec: number;
  date?: string;
}>;

const planOf = (args: RhythmArgs) => ({
  subjectRef: args.subject_ref,
  recording: args.recording,
  durationSec: args.duration_sec,
  date: args.date ?? "",
  afConditionActive: args.subject_ref === AF_SUBJECT && (args.date ?? "") >= AF_ONSET_DAY,
});

const rhythmEntries = Object.values(key.entries)
  .flat()
  .filter((entry) => entry.tool === "rhythm_irregularity");
const answeredRhythm = rhythmEntries.filter((entry) => entry.refusal === null);

describe("questions.s7.v1.json", () => {
  test("about 30 items, all S7, numbered in order", () => {
    expect(items.length).toBeGreaterThanOrEqual(28);
    expect(items.length).toBeLessThanOrEqual(36);
    expect(items.every((item) => item.scenario === "S7")).toBe(true);
    expect(items.map((item) => item.id)).toEqual(
      items.map((_, index) => `Q-S7-${String(index + 1).padStart(2, "0")}`),
    );
  });

  test("criteria use the eight names, with consistency and latency items", () => {
    const used = new Set(items.flatMap((item) => item.criteria));
    expect([...used].sort()).toEqual([...CRITERIA].sort());
    const repeated = items.filter((item) => item.repeat > 1);
    expect(repeated.every((item) => item.repeat === CONSISTENCY_REPEAT)).toBe(true);
    expect(repeated.length).toBeGreaterThanOrEqual(2);
    expect(
      items.filter((item) => item.tags?.includes(LATENCY_SET_TAG)).length,
    ).toBeGreaterThanOrEqual(1);
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

  test("a subject named in the question is the item's subject_ref", () => {
    const mismatched = items.filter(
      (item) =>
        item.subject_ref !== undefined && !item.question.includes(item.subject_ref),
    );
    expect(mismatched.map((item) => item.id)).toEqual([]);
  });

  test("the items cover what #251 asks for", () => {
    const tagged = (tag: string) =>
      items.filter((item) => item.tags?.includes(tag)).map((item) => item.id);
    expect(tagged("rhythm-metrics").length).toBeGreaterThanOrEqual(5);
    expect(tagged("rhythm-burden").length).toBeGreaterThanOrEqual(2);
    expect(tagged("rhythm-compare").length).toBeGreaterThanOrEqual(2);
    expect(tagged("af-onset").length).toBe(3);
    expect(tagged("heart-brain").length).toBeGreaterThanOrEqual(5);
    expect(tagged("rhythm-decline").length).toBe(4);
    expect(tagged("rhythm-personal").length).toBe(1);
    const declines = items.filter((item) => item.tags?.includes("rhythm-decline"));
    expect(
      declines.every(
        (item) =>
          item.expect.answer_class === "declined_decision_support" &&
          item.expect.next_step === "consult_clinician",
      ),
    ).toBe(true);
  });
});

describe("no ground truth where a model could see it", () => {
  const TRUTH_WORDS =
    /fibrillation|\baf\b|sinus|paroxysm|episode|ectopic|premature|\bpac\b|\bpvc\b|ground truth|profile/i;

  test("rhythm metric, burden and comparison questions name no rhythm or condition", () => {
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
        /\b(has|had|with) (atrial fibrillation|a stroke|dementia)\b/i.test(item.question),
      )
      .map((item) => item.id);
    expect(asserting).toEqual([]);
  });

  test("the tool's output and every keyed path hold no simulator truth", () => {
    const truthFields = Object.keys(
      rhythmGroundTruth(
        planOf({
          subject_ref: AF_SUBJECT,
          recording: 1,
          duration_sec: 300,
          date: "2020-08-18",
        }),
      ),
    );
    const output = describeRecording(
      planOf({
        subject_ref: AF_SUBJECT,
        recording: 1,
        duration_sec: 300,
        date: "2020-08-18",
      }),
    );
    const outputText = JSON.stringify(output);
    expect(truthFields.filter((field) => outputText.includes(`"${field}"`))).toEqual([]);
    expect(TRUTH_WORDS.test(Object.keys(output).join(" "))).toBe(false);
    const paths = rhythmEntries.map((entry) => entry.path);
    expect(
      paths.filter((path) => truthFields.some((field) => path.includes(field))),
    ).toEqual([]);
    expect(truthFields.filter((field) => keyText.includes(`"${field}"`))).toEqual([]);
  });
});

describe("answer-key.s7.v1.json", () => {
  test("was built from these questions and the pinned cohort", () => {
    expect(key.questions_sha256).toBe(questionsSha256(rawQuestions));
    const preset = COHORT_PRESETS.eval;
    expect(key.cohort.id).toBe(preset.cohortId);
    expect(key.cohort.seed).toBe(preset.seed);
    expect(key.cohort.reference_date).toBe(preset.referenceDate);
    expect(key.cohort.end_date).toBe(preset.endDate);
    expect(key.cohort.content_sha256).toBe(EVAL_CONTENT_SHA256);
    expect(key.cohort.subjects).toBe(37);
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
  });

  test("refusals are keyed with their codes", () => {
    const refusals = Object.entries(key.entries)
      .flatMap(([id, entries]) =>
        entries
          .filter((entry) => entry.refusal !== null)
          .map((entry) => `${id} ${entry.refusal}`),
      )
      .sort();
    expect(refusals).toEqual([
      "Q-S7-14 OUTSIDE_SUBJECT_WINDOW",
      "Q-S7-15 SUBJECT_SCOPE_VIOLATION",
      "Q-S7-18 NO_ROWS",
      "Q-S7-19 NO_ROWS",
      "Q-S7-20 NO_ROWS",
      "Q-S7-21 NO_ROWS",
      "Q-S7-24 NO_ROWS",
      "Q-S7-25 NO_ROWS",
      "Q-S7-26 NO_ROWS",
      "Q-S7-27 NO_ROWS",
      "Q-S7-32 NO_RHYTHM_DATA",
    ]);
    expect(
      Object.values(key.entries)
        .flat()
        .filter((entry) => entry.value === null),
    ).toEqual([]);
  });

  test("every rhythm value is the tool's own output for that recording", () => {
    const differ = answeredRhythm.flatMap((entry) => {
      const result = describeRecording(planOf(entry.args as RhythmArgs));
      return readPath(result, entry.path) === entry.value &&
        readPath(result, "n") === entry.n
        ? []
        : [`${entry.name} ${JSON.stringify(entry.args)}`];
    });
    expect(answeredRhythm.length).toBeGreaterThanOrEqual(30);
    expect(differ).toEqual([]);
  });

  test("the AF subject's recordings carry AF and the others are sinus, as the items were written", () => {
    // Scorer side only: rhythmGroundTruth is never in a tool output or a question.
    const truth = answeredRhythm.map((entry) => {
      const args = entry.args as RhythmArgs;
      const groundTruth = rhythmGroundTruth(planOf(args));
      return [
        args.subject_ref === AF_SUBJECT,
        groundTruth.profile,
        groundTruth.afIntervalShare > 0,
      ];
    });
    expect(
      truth.every(([af, profile, share]) =>
        af ? profile === "paroxysmal_af" && share : profile === "sinus" && !share,
      ),
    ).toBe(true);
    // Windows past the threshold appear in the AF subject's recordings only.
    const flagged = answeredRhythm
      .filter(
        (entry) => entry.path === "n_flagged" || entry.path === "flagged_time_share",
      )
      .map((entry) => [
        (entry.args as RhythmArgs).subject_ref === AF_SUBJECT,
        typeof entry.value === "number" && entry.value > 0,
      ]);
    expect(flagged.every(([af, positive]) => af === positive)).toBe(true);
    // Q-S7-22 reads the same record: one AF condition, no abatement recorded.
    expect(entriesOf("Q-S7-22").map((entry) => [entry.name, entry.value])).toEqual([
      ["n", 1],
      ["n_without_abatement", 1],
    ]);
  });

  test("every recording day is named and no window reaches the synthetic wearable series", () => {
    const late = Object.values(key.entries)
      .flat()
      .filter((entry) => {
        const args = entry.args as Record<string, unknown>;
        if (entry.tool === "rhythm_irregularity" && entry.mode === undefined) {
          return typeof args.date !== "string" || args.date >= WEARABLE_SERIES_START;
        }
        const ends = [args.end, args.date].filter(
          (value): value is string => typeof value === "string",
        );
        return ends.some((end) => end >= WEARABLE_SERIES_START);
      })
      .map((entry) => entry.name);
    expect(late).toEqual([]);
  });

  test("the personal-mode item keys NO_RHYTHM_DATA, which the tool gives before any read", async () => {
    const entry = entriesOf("Q-S7-32")[0];
    expect(entry?.mode).toBe("personal");
    const reads: string[] = [];
    const audit: AppendInput[] = [];
    const ports: QueryToolPorts = {
      findSubject: async () => {
        reads.push("subject");
        return null;
      },
      findObservations: async () => {
        reads.push("observations");
        return [];
      },
      findCohortObservations: async () => [],
      appendAudit: async (input) => {
        audit.push(input);
      },
    };
    const result = await runRhythmIrregularity(
      { actor: "test", sessionId: "s7", mode: "personal" },
      entry?.args as RhythmArgs,
      ports,
    );
    expect(Reflect.get(result, "code")).toBe(entry?.value);
    expect(reads).toEqual([]);
    expect(audit.map((row) => [row.subjectRef, row.rowCount])).toEqual([[null, 0]]);
  });
});

// RUN_LIVE and EVAL_COHORT_DIR are test-runner switches, not app config, read
// here as evaluation/answer-key.test.ts reads RUN_LIVE.
const runLive = Reflect.get(process.env, "RUN_LIVE") === "1";
const cohortDir = Reflect.get(process.env, "EVAL_COHORT_DIR");

describe.skipIf(!runLive || typeof cohortDir !== "string")(
  "S7 key against the cohort files (RUN_LIVE=1, EVAL_COHORT_DIR)",
  () => {
    test("a fresh build over the pinned cohort gives the committed key", async () => {
      const fresh = await buildAnswerKey(
        rawQuestions,
        await cohortFilePorts(String(cohortDir), key.generated_on),
      );
      expect(fresh.cohort).toEqual(key.cohort);
      expect(fresh.open_twin_sha).toBe(key.open_twin_sha);
      expect(fresh.entries).toEqual(key.entries);
    }, 120_000);
  },
);

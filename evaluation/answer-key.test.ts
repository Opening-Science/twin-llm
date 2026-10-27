/**
 * Drift check for the C2 question set and its answer key. Offline by default:
 * the committed files must validate, agree with each other and meet the
 * coverage the November test set promises. With RUN_LIVE=1 and `.env.eval` (a
 * copy of `.env.synthetic.example` with DATABASE_URL at a throwaway database
 * holding synthea-v4-seed42; never `.env.local`), it first checks that
 * `.synthea/fhir` is the cohort the key was built from (its checksum against
 * `manifest.json` and the key), then re-runs the generator through the audited
 * tools and diffs the result against the committed key. `generated_on` is left
 * out of the diff:
 *
 *   bun run eval:answer-key:live
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { BANNED_TERMS } from "../scripts/lint-claims";
import {
  buildAnswerKey,
  EVAL_FHIR_DIR,
  questionsSha256,
  realPorts,
} from "../scripts/evaluation/build-answer-key";
import {
  answerKeySchema,
  CONSISTENCY_REPEAT,
  coverageCounts,
  CRITERIA,
  LATENCY_SET_TAG,
  questionSetSchema,
  SCENARIOS,
} from "../scripts/evaluation/question-set";
import { cohortContentSha256 } from "../scripts/synthea/cohort-checksum";
import { COHORT_PRESETS, EVAL_CONTENT_SHA256 } from "../scripts/synthea/cohort-presets";

const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8"));

const rawQuestions = readJson("./questions.v1.json");
const rawKey = readJson("./answer-key.v1.json");
const set = questionSetSchema.parse(rawQuestions);
const key = answerKeySchema.parse(rawKey);
const items = set.items;

describe("questions.v1.json", () => {
  test("ids are unique", () => {
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("80 ± 10 items", () => {
    expect(items.length).toBeGreaterThanOrEqual(70);
    expect(items.length).toBeLessThanOrEqual(90);
  });

  test("criteria use the eight names exactly", () => {
    const used = new Set(items.flatMap((item) => item.criteria));
    expect([...used].sort()).toEqual([...CRITERIA].sort());
  });

  test("every criterion has at least 8 items and every scenario at least 6", () => {
    const counts = coverageCounts(items);
    const shortCriteria = CRITERIA.filter(
      (criterion) => counts.byCriterion[criterion] < 8,
    );
    const shortScenarios = SCENARIOS.filter(
      (scenario) => counts.byScenario[scenario] < 6,
    );
    expect(shortCriteria).toEqual([]);
    expect(shortScenarios).toEqual([]);
  });

  test("8 consistency items, each asked 3 times", () => {
    const repeated = items.filter((item) => item.repeat > 1);
    expect(repeated.length).toBe(8);
    expect(repeated.every((item) => item.repeat === CONSISTENCY_REPEAT)).toBe(true);
  });

  test("5 items form the latency set, all scored for latency", () => {
    const latency = items.filter((item) => item.tags?.includes(LATENCY_SET_TAG));
    expect(latency.length).toBe(5);
    expect(latency.every((item) => item.criteria.includes("latency"))).toBe(true);
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
});

describe("answer-key.v1.json", () => {
  test("was built from these questions", () => {
    expect(key.questions_sha256).toBe(questionsSha256(rawQuestions));
    expect(key.cohort.id).toBe(set.cohort_id);
  });

  test("was built from the pinned evaluation cohort", () => {
    const preset = COHORT_PRESETS.eval;
    expect(key.cohort.id).toBe(preset.cohortId);
    expect(key.cohort.seed).toBe(preset.seed);
    expect(key.cohort.population).toBe(preset.population);
    expect(key.cohort.age).toBe(preset.age);
    expect(key.cohort.reference_date).toBe(preset.referenceDate);
    expect(key.cohort.end_date).toBe(preset.endDate);
    expect(key.cohort.content_sha256).toBe(EVAL_CONTENT_SHA256);
  });

  test("every value has a key entry with the same call", () => {
    const missing = items.flatMap((item) =>
      (item.expect.values ?? [])
        .filter((spec) => {
          const entry = key.entries[item.id]?.find(
            (candidate) => candidate.name === spec.name,
          );
          return (
            entry === undefined ||
            entry.tool !== spec.tool ||
            entry.path !== spec.path ||
            JSON.stringify(entry.args) !== JSON.stringify(spec.args)
          );
        })
        .map((spec) => `${item.id} ${spec.name}`),
    );
    expect(missing).toEqual([]);
  });

  test("the key holds no entry the questions do not ask for", () => {
    const asked = new Set(
      items.flatMap((item) =>
        (item.expect.values ?? []).map((spec) => `${item.id} ${spec.name}`),
      ),
    );
    const extra = Object.entries(key.entries).flatMap(([id, entries]) =>
      entries.map((entry) => `${id} ${entry.name}`).filter((name) => !asked.has(name)),
    );
    expect(extra).toEqual([]);
  });

  test("numeric values carry the unit the item expects", () => {
    const wrong = items.flatMap((item) =>
      (item.expect.values ?? [])
        .filter((spec) => {
          const entry = key.entries[item.id]?.find(
            (candidate) => candidate.name === spec.name,
          );
          return typeof entry?.value === "number" && entry.unit !== spec.unit;
        })
        .map((spec) => `${item.id} ${spec.name}`),
    );
    expect(wrong).toEqual([]);
  });

  test("refusal probes are keyed with their refusal", () => {
    const refusals = Object.entries(key.entries)
      .flatMap(([id, entries]) =>
        entries
          .filter((entry) => entry.refusal !== null)
          .map((entry) => `${id} ${entry.refusal}`),
      )
      .sort();
    expect(refusals).toEqual([
      "Q-S1-17 UNSUPPORTED_CONVERSION",
      "Q-S6-03 SUBJECT_SCOPE_VIOLATION",
      "Q-S6-09 MIXED_UNITS",
      "Q-S6-10 MIXED_UNITS",
      "Q-S6-11 MIXED_UNITS",
      "Q-S6-17 SUBJECT_SCOPE_VIOLATION",
    ]);
  });

  test("convert-unit items convert the value the key read, and name their measures", () => {
    // The convert_unit args carry the latest value by hand; a cohort or subject
    // change that moves it must fail here, not pass with a stale conversion.
    const tagged = items.filter((item) => item.tags?.includes("convert-unit"));
    expect(tagged.map((item) => item.id)).toEqual(["Q-S1-15", "Q-S1-16", "Q-S1-17"]);
    const stale = tagged.filter((item) => {
      const read = key.entries[item.id]?.find(
        (entry) => entry.tool === "latest_by_loinc",
      );
      const converted = (item.expect.values ?? []).find(
        (spec) => spec.tool === "convert_unit",
      );
      return (
        item.expect.measures === undefined ||
        read === undefined ||
        converted?.args.value !== read.value
      );
    });
    expect(stale.map((item) => item.id)).toEqual([]);
  });

  test("only the absent-code probe is keyed as null", () => {
    // A null slope or mean elsewhere means the subject has too few readings.
    const nulls = Object.entries(key.entries).flatMap(([id, entries]) =>
      entries
        .filter((entry) => entry.value === null && entry.refusal === null)
        .map((entry) => `${id} ${entry.name}`),
    );
    expect(nulls).toEqual(["Q-S6-05 value"]);
  });
});

// RUN_LIVE is a test-runner switch, not app config, so it is read here rather
// than through infrastructure/env.ts, the same exception as
// packages/gbd-mcp/live.test.ts.
const runLive = Reflect.get(process.env, "RUN_LIVE") === "1";

describe.skipIf(!runLive)("answer key against the cohort (RUN_LIVE=1)", () => {
  test("a fresh run gives the committed key", async () => {
    // Loaded here, not at the top: infrastructure/env.ts imports server-only, and
    // CI runs plain `bun test` with no stub, so a static import would break
    // every later test file. Never read a database the env does not mark synthetic.
    const { serverEnv } = await import("../infrastructure/env");
    expect(serverEnv().DATA_MODE).toBe("synthetic");
    // A different cohort on disk explains every later difference, so say so first.
    const manifest = JSON.parse(
      await readFile(`${COHORT_PRESETS.eval.out}/manifest.json`, "utf8"),
    ) as unknown;
    const onDisk = await cohortContentSha256(EVAL_FHIR_DIR);
    expect(onDisk).toBe(Reflect.get(manifest as object, "contentSha256"));
    expect(onDisk).toBe(key.cohort.content_sha256);
    const fresh = await buildAnswerKey(rawQuestions, await realPorts(key.generated_on));
    expect(fresh.cohort).toEqual(key.cohort);
    expect(fresh.open_twin_sha).toBe(key.open_twin_sha);
    expect(fresh.entries).toEqual(key.entries);
  }, 120_000);
});

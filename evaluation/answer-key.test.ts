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
  V1_SCENARIOS,
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
  test("holds no S7 item: S7 has its own file (#251), so this hash never moves for it", () => {
    expect(items.filter((item) => item.scenario === "S7")).toEqual([]);
  });

  test("ids are unique", () => {
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("70 to 140 items", () => {
    expect(items.length).toBeGreaterThanOrEqual(70);
    expect(items.length).toBeLessThanOrEqual(140);
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
    const shortScenarios = V1_SCENARIOS.filter(
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
      "Q-S6-03 SUBJECT_SCOPE_VIOLATION",
      "Q-S6-05 NO_ROWS",
      "Q-S6-09 MIXED_UNITS",
      "Q-S6-10 MIXED_UNITS",
      "Q-S6-11 MIXED_UNITS",
      "Q-S6-17 SUBJECT_SCOPE_VIOLATION",
      "Q-S6-18 NO_PUBLISHED_RANGE",
      "Q-S6-19 NO_ROWS",
      "Q-S6-20 UNSUPPORTED_CONVERSION",
      "Q-S6-21 COHORT_TOO_SMALL",
      "Q-S6-22 NO_ROWS",
      "Q-S6-23 NO_ROWS",
      "Q-S6-24 SOURCE_NOT_CONNECTED",
      "Q-S6-25 WINDOW_TOO_SHORT",
      "Q-S6-26 NO_ROWS",
      "Q-S6-27 SOURCE_NOT_CONNECTED",
      "Q-S6-28 NO_ROWS",
      "Q-S6-29 MIXED_UNITS",
      "Q-S6-30 NO_ROWS",
      "Q-S6-31 WINDOW_TOO_SHORT",
      "Q-S6-32 NO_ROWS",
      "Q-S6-33 NO_ROWS",
      "Q-S6-34 NO_ROWS",
      "Q-S6-35 NO_ROWS",
    ]);
  });

  test("each wearable tool has three items, one of them a refusal, all naming measures", () => {
    const tagged = items.filter((item) => item.tags?.includes("wearable-tools"));
    const perTool = Object.fromEntries(
      ["sleep_summary", "hrv_trend", "resting_hr_trend", "training_load"].map((tool) => [
        tool,
        tagged
          .filter((item) => item.expect.values?.some((spec) => spec.tool === tool))
          .map((item) => [item.id, key.entries[item.id]?.[0]?.refusal ?? null]),
      ]),
    );
    expect(perTool).toEqual({
      sleep_summary: [
        ["Q-S1-26", null],
        ["Q-S1-27", null],
        ["Q-S6-24", "SOURCE_NOT_CONNECTED"],
      ],
      hrv_trend: [
        ["Q-S1-28", null],
        ["Q-S1-29", null],
        ["Q-S6-25", "WINDOW_TOO_SHORT"],
      ],
      resting_hr_trend: [
        ["Q-S1-30", null],
        ["Q-S1-31", null],
        ["Q-S6-26", "NO_ROWS"],
      ],
      training_load: [
        ["Q-S1-32", null],
        ["Q-S1-33", null],
        ["Q-S6-27", "SOURCE_NOT_CONNECTED"],
      ],
    });
    expect(tagged.filter((item) => item.expect.measures === undefined)).toEqual([]);
  });

  test("clinical-timeline items: two lists and one refusal per tool, counts keyed exactly", () => {
    const tagged = items.filter((item) => item.tags?.includes("clinical-timeline"));
    expect(
      tagged.map((item) => [item.id, item.expect.values?.map((spec) => spec.tool)[0]]),
    ).toEqual([
      ["Q-S1-21", "conditions_timeline"],
      ["Q-S1-22", "conditions_timeline"],
      ["Q-S1-23", "medications_timeline"],
      ["Q-S1-24", "medications_timeline"],
      ["Q-S6-22", "conditions_timeline"],
      ["Q-S6-23", "medications_timeline"],
    ]);
    const loose = tagged.flatMap((item) =>
      (item.expect.values ?? [])
        .filter((spec) => spec.unit !== null || !("exact" in spec.tolerance))
        .map((spec) => `${item.id} ${spec.name}`),
    );
    expect(loose).toEqual([]);
  });

  test("convert-unit items convert the value the key read, and name their measures", () => {
    // The convert_unit args carry the latest value by hand; a cohort or subject
    // change that moves it must fail here, not pass with a stale conversion.
    const tagged = items.filter((item) => item.tags?.includes("convert-unit"));
    expect(tagged.map((item) => item.id)).toEqual(["Q-S1-17", "Q-S1-18", "Q-S6-20"]);
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

  test("cohort-position items rank against at least 10 people, or refuse", () => {
    const tagged = items.filter((item) => item.tags?.includes("cohort-position"));
    expect(tagged.map((item) => item.id)).toEqual(["Q-S1-19", "Q-S1-20", "Q-S6-21"]);
    const keyed = tagged.map((item) => {
      const entries = key.entries[item.id] ?? [];
      const n = entries.find((entry) => entry.name === "n")?.value;
      const refusal = entries.find((entry) => entry.refusal !== null)?.refusal ?? null;
      return [
        item.id,
        item.expect.measures,
        refusal ?? (typeof n === "number" && n >= 10),
      ];
    });
    expect(keyed).toEqual([
      ["Q-S1-19", ["4548-4"], true],
      ["Q-S1-20", ["8480-6"], true],
      ["Q-S6-21", ["2276-4"], "COHORT_TOO_SMALL"],
    ]);
  });

  test("only the field the synthetic series does not record is keyed as null", () => {
    // A null slope or mean elsewhere means the subject has too few readings.
    // Q-S1-40 asks for sleep efficiency, which the series never writes. Q-S6-05,
    // the absent-code probe, is a NO_ROWS refusal since latest_by_loinc refuses (#196).
    const nulls = Object.entries(key.entries).flatMap(([id, entries]) =>
      entries
        .filter((entry) => entry.value === null && entry.refusal === null)
        .map((entry) => `${id} ${entry.name}`),
    );
    expect(nulls).toEqual(["Q-S1-40 mean_efficiency_pct"]);
  });

  test("values-around-event items: five comparisons and three refusals, all naming their code", () => {
    const tagged = items.filter((item) => item.tags?.includes("values-around-event"));
    const keyed = tagged.map((item) => [
      item.id,
      item.expect.values?.every((spec) => spec.tool === "values_around_event"),
      item.expect.measures,
      key.entries[item.id]?.find((entry) => entry.refusal !== null)?.refusal ?? null,
    ]);
    expect(keyed).toEqual([
      ["Q-S1-34", true, ["18262-6"], null],
      ["Q-S1-35", true, ["4548-4"], null],
      ["Q-S1-36", true, ["39156-5"], null],
      ["Q-S1-37", true, ["8480-6"], null],
      ["Q-S1-38", true, ["33914-3"], null],
      ["Q-S6-28", true, ["4548-4"], "NO_ROWS"],
      ["Q-S6-29", true, ["33914-3"], "MIXED_UNITS"],
      ["Q-S6-30", true, ["4548-4"], "NO_ROWS"],
    ]);
    // Q-S1-38 has readings after the onset only: nothing to compare with.
    const oneSided = key.entries["Q-S1-38"]?.map((entry) => [entry.name, entry.value]);
    expect(oneSided?.slice(0, 2)).toEqual([
      ["before_n", 0],
      ["after_n", 2],
    ]);
  });

  test("wearable-edge items: three answers and three refusals, all naming measures", () => {
    const tagged = items.filter((item) => item.tags?.includes("wearable-edge"));
    expect(
      tagged.map((item) => [
        item.id,
        item.expect.values?.[0]?.tool,
        key.entries[item.id]?.[0]?.refusal ?? null,
      ]),
    ).toEqual([
      ["Q-S1-39", "training_load", null],
      ["Q-S1-40", "sleep_summary", null],
      ["Q-S1-41", "resting_hr_trend", null],
      ["Q-S6-31", "resting_hr_trend", "WINDOW_TOO_SHORT"],
      ["Q-S6-32", "sleep_summary", "NO_ROWS"],
      ["Q-S6-33", "training_load", "NO_ROWS"],
    ]);
    expect(tagged.filter((item) => item.expect.measures === undefined)).toEqual([]);
  });

  test("clinical-timeline-edge items: counts keyed exactly, two refusals", () => {
    const tagged = items.filter((item) => item.tags?.includes("clinical-timeline-edge"));
    expect(
      tagged.map((item) => [
        item.id,
        item.expect.values?.[0]?.tool,
        key.entries[item.id]?.[0]?.refusal ?? null,
      ]),
    ).toEqual([
      ["Q-S1-42", "conditions_timeline", null],
      ["Q-S1-43", "conditions_timeline", null],
      ["Q-S1-44", "conditions_timeline", null],
      ["Q-S1-45", "medications_timeline", null],
      ["Q-S6-34", "medications_timeline", "NO_ROWS"],
      ["Q-S6-35", "conditions_timeline", "NO_ROWS"],
    ]);
    const loose = tagged.flatMap((item) =>
      (item.expect.values ?? [])
        .filter((spec) => spec.unit !== null || !("exact" in spec.tolerance))
        .map((spec) => `${item.id} ${spec.name}`),
    );
    expect(loose).toEqual([]);
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
    const ports = await realPorts(key.generated_on);
    // #145: the same gate the key builder asks; this database must hold synthetic subjects only.
    const { requireLearningConsent } = await import("../infrastructure/learning-consent");
    const { databaseLearningGate } =
      await import("../infrastructure/learning-consent-store");
    const permit = await requireLearningConsent(
      "answer-key",
      await ports.learningRows(),
      databaseLearningGate(),
    );
    expect(permit).toEqual({ ok: true, scope: "answer-key", consentIds: [] });
    const fresh = await buildAnswerKey(rawQuestions, ports);
    expect(fresh.cohort).toEqual(key.cohort);
    expect(fresh.open_twin_sha).toBe(key.open_twin_sha);
    expect(fresh.entries).toEqual(key.entries);
  }, 120_000);
});

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { GUIDELINE_MANIFEST } from "../../packages/guidelines/manifest";
import { randomFor } from "../../infrastructure/seeded-random";
import { ANATOMY_BANK } from "../training-data/anatomy-families";
import { GENOME_BANK } from "../training-data/genome-questions";
import { HANDOVER_BANK } from "../training-data/handover-family";
import { BANK } from "../training-data/questions";
import { WEARABLE_BANK } from "../training-data/wearable-families";
import { EVALUATION_COHORT_IDS } from "../synthea/cohort-presets";

import type { CohortSubject } from "./cohort-ports";
import { QUESTION_SETS } from "./eval-results";
import { overlaps, type Text } from "./heldout-overlap";
import {
  absentLoincsOf,
  baselineCandidates,
  compareCandidates,
  coverageCandidates,
  gapCandidates,
  gbdCandidates,
  generateV1hSet,
  HELDOUT_MEASURES,
  heldoutV1hSubjectFrom,
  outOfCohortRef,
  TEMPLATES,
  trendCandidates,
  V1_GBD_TRIPLES,
  V1H_SEED,
  V1H_SUBJECTS_PATH,
  type V1hSubject,
  v1hSubjectsSchema,
} from "./heldout-v1h";
import { COHORT_ID, CONSISTENCY_REPEAT, type QuestionSet } from "./question-set";

const ROOT = join(import.meta.dir, "../..");
const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(join(ROOT, path), "utf8")) as unknown;

const table = v1hSubjectsSchema.parse(readJson(V1H_SUBJECTS_PATH));
const catalogue = GUIDELINE_MANIFEST.map((entry) => ({
  id: entry.id,
  title: entry.title,
}));
const set = generateV1hSet(V1H_SEED, { table, catalogue });
const subjectOf = (ref: string | undefined): V1hSubject => {
  const found = table.subjects.find((subject) => subject.subject_ref === ref);
  if (found === undefined) throw new Error(`no subject ${String(ref)}`);
  return found;
};

const at = (iso: string) => new Date(iso);
const observation = (loinc: string, iso: string, unitUcum = "U/L") => ({
  loinc,
  value: 20,
  unitUcum,
  effectiveAt: at(iso),
});

const cohortSubject: CohortSubject = {
  subjectRef: "s-1",
  scope: { isSynthetic: true, cohortId: COHORT_ID },
  observations: [
    observation("1742-6", "2020-02-01T10:00:00Z"),
    observation("1742-6", "2020-02-01T18:00:00Z"),
    observation("1742-6", "2020-06-01T10:00:00Z"),
    observation("1742-6", "2021-03-01T10:00:00Z"),
    observation("1742-6", "2023-03-01T10:00:00Z"),
    observation("1742-6", "2023-09-01T10:00:00Z"),
    observation("777-3", "2023-09-01T10:00:00Z", "10*3/uL"),
    observation("8867-4", "2015-01-01T10:00:00Z", "/min"),
  ],
  conditions: [
    {
      id: "c1",
      codeSystem: "http://snomed.info/sct",
      code: "59621000",
      display: "Essential hypertension",
      onsetAt: at("2019-05-01T00:00:00Z"),
      abatementAt: null,
      clinicalStatus: "active",
      verificationStatus: null,
    },
    {
      id: "c2",
      codeSystem: "http://snomed.info/sct",
      code: "444814009",
      display: "Viral sinusitis",
      onsetAt: null,
      abatementAt: null,
      clinicalStatus: "resolved",
      verificationStatus: null,
    },
  ],
  medicationRequests: [],
};

const facts = heldoutV1hSubjectFrom(cohortSubject);

describe("heldoutV1hSubjectFrom", () => {
  test("reads the years, the reading days and units of each held-out measure, and onset years", () => {
    expect(facts).toEqual({
      subject_ref: "s-1",
      first_year: 2015,
      last_year: 2023,
      measures: {
        "777-3": { "2023": { days: 1, units: ["10*3/uL"] } },
        "1742-6": {
          "2020": { days: 2, units: ["U/L"] },
          "2021": { days: 1, units: ["U/L"] },
          "2023": { days: 2, units: ["U/L"] },
        },
      },
      condition_onset_years: [2019],
    });
  });

  test("a subject without observations is left out", () => {
    expect(heldoutV1hSubjectFrom({ ...cohortSubject, observations: [] })).toBe(null);
  });

  test("absent codes are the candidates no record holds", () => {
    const holder = {
      ...cohortSubject,
      observations: [observation("3040-3", "2020-01-01T00:00:00Z")],
    };
    expect(absentLoincsOf([cohortSubject, holder])).toEqual([
      "10839-9",
      "33959-8",
      "3255-7",
      "1798-8",
    ]);
  });
});

describe("candidates", () => {
  if (facts === null) throw new Error("no facts");

  test("a trend window has three reading days in one unit", () => {
    const alt = trendCandidates(facts).filter((pick) => pick.loinc === "1742-6");
    expect(alt.map((pick) => [pick.span.from, pick.span.to])).toEqual([
      [2020, 2021],
      [2019, 2021],
      [2018, 2021],
      [2017, 2021],
      [2021, 2023],
      [2020, 2023],
      [2019, 2023],
    ]);
    expect(trendCandidates(facts).filter((pick) => pick.loinc === "777-3")).toEqual([]);
  });

  test("a baseline needs two days in the target year and in the three years before", () => {
    expect(baselineCandidates(facts)).toEqual([
      {
        loinc: "1742-6",
        baseline: { from: 2020, to: 2022 },
        target: 2023,
        unit: "U/L",
      },
    ]);
  });

  test("a comparison takes two years at least two apart, each with two days", () => {
    expect(compareCandidates(facts)).toEqual([
      { loinc: "1742-6", a: 2020, b: 2023, unit: "U/L" },
    ]);
  });

  test("a gap year lies inside the record and has no reading of the measure", () => {
    const years = gapCandidates(facts)
      .filter((pick) => pick.loinc === "1742-6")
      .map((pick) => pick.year);
    expect(years).toEqual([2015, 2016, 2017, 2018, 2019, 2022]);
  });

  test("coverage pairs two different held-out measures", () => {
    const picks = coverageCandidates(facts);
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every((pick) => pick.loincs[0] !== pick.loincs[1])).toBe(true);
  });

  test("no GBD query repeats the measure, location and cause of a v1 item", () => {
    const queries = gbdCandidates();
    const taken = new Set(V1_GBD_TRIPLES.map((triple) => triple.join("|")));
    expect(queries.length).toBeGreaterThan(500);
    expect(
      queries.filter((query) =>
        taken.has([query.measure, query.location, query.cause].join("|")),
      ),
    ).toEqual([]);
  });

  test("an out-of-cohort ref has the cohort's shape and is not taken", () => {
    const random = randomFor(1, "refs");
    const ref = outOfCohortRef(random, new Set());
    expect(ref).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const again = outOfCohortRef(randomFor(1, "refs"), new Set([ref]));
    expect(again).not.toBe(ref);
  });
});

describe("generateV1hSet", () => {
  test("the same seed and table give the same set; another seed does not", () => {
    expect(generateV1hSet(V1H_SEED, { table, catalogue })).toEqual(set);
    const shuffled = { ...table, subjects: [...table.subjects].reverse() };
    expect(generateV1hSet(V1H_SEED, { table: shuffled, catalogue })).toEqual(set);
    expect(
      generateV1hSet(V1H_SEED + 1, { table, catalogue }).items.map(
        (item) => item.question,
      ),
    ).not.toEqual(set.items.map((item) => item.question));
  });

  test("32 items over S1 to S6, numbered per scenario", () => {
    const byScenario = Object.fromEntries(
      ["S1", "S2", "S3", "S4", "S5", "S6"].map((scenario) => [
        scenario,
        set.items.filter((item) => item.scenario === scenario).map((item) => item.id),
      ]),
    );
    expect(Object.values(byScenario).map((ids) => ids.length)).toEqual([
      9, 8, 3, 3, 4, 5,
    ]);
    expect(byScenario.S1?.[0]).toBe("Q-S1-H01");
    expect(byScenario.S6?.at(-1)).toBe("Q-S6-H05");
    expect(set.cohort_id).toBe(COHORT_ID);
    expect(set.items.every((item) => item.tags?.includes("heldout"))).toBe(true);
  });

  test("the first item of each scenario repeats and is in the latency set", () => {
    const repeated = set.items.filter((item) => item.repeat > 1);
    expect(repeated.map((item) => item.id)).toEqual(
      ["S1", "S2", "S3", "S4", "S5", "S6"].map((scenario) => `Q-${scenario}-H01`),
    );
    expect(
      repeated.every(
        (item) =>
          item.repeat === CONSISTENCY_REPEAT &&
          item.criteria.includes("consistency") &&
          item.tags?.includes("latency-set"),
      ),
    ).toBe(true);
  });

  test("every data window is one the record supports", () => {
    const wrong = set.items.flatMap((item) =>
      (item.expect.values ?? []).flatMap((value) => {
        const args = value.args as Record<string, unknown>;
        if (item.tags?.includes("out-of-cohort-probe")) {
          return table.subjects.some(
            (subject) => subject.subject_ref === args.subject_ref,
          )
            ? [item.id]
            : [];
        }
        const subject = subjectOf(item.subject_ref);
        if (item.tags?.includes("absent-loinc-probe")) {
          return table.absent_loincs.includes(String(args.loinc)) ? [] : [item.id];
        }
        if (item.tags?.includes("outside-record-probe")) {
          const year = String(args.start).slice(0, 4);
          return subject.measures[String(args.loinc)]?.[year] === undefined
            ? []
            : [item.id];
        }
        if (value.tool === "trend") {
          const from = Number(String(args.start).slice(0, 4));
          const to = Number(String(args.end).slice(0, 4));
          const days = Object.entries(subject.measures[String(args.loinc)] ?? {})
            .filter(([year]) => Number(year) >= from && Number(year) <= to)
            .reduce((total, [, facts]) => total + facts.days, 0);
          return days >= 3 ? [] : [item.id];
        }
        return [];
      }),
    );
    expect(wrong).toEqual([]);
  });

  test("the items spread over the cohort, at most three per subject", () => {
    const counts = new Map<string, number>();
    for (const item of set.items) {
      if (item.subject_ref === undefined || item.tags?.includes("out-of-cohort-probe"))
        continue;
      counts.set(item.subject_ref, (counts.get(item.subject_ref) ?? 0) + 1);
    }
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
    expect(counts.size).toBeGreaterThan(15);
  });
});

/** The question files of every other set: none may share wording with v1h. */
const existingItems = (): Text[] =>
  Object.entries(QUESTION_SETS)
    .filter(([id]) => id !== "v1h")
    .flatMap(([, files]) =>
      (readJson(files.questions) as QuestionSet).items.map((item) => ({
        id: item.id,
        text: item.question,
      })),
    );

type AnyBank = Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;

/** Every training question template, in every style (`scripts/training-data`). */
const trainingTemplates = (): Text[] =>
  ([BANK, WEARABLE_BANK, ANATOMY_BANK, HANDOVER_BANK, GENOME_BANK] as AnyBank[]).flatMap(
    (bank) =>
      Object.entries(bank).flatMap(([slot, styles]) =>
        Object.entries(styles).flatMap(([style, texts]) =>
          texts.map((text, index) => ({ id: `${slot}.${style}.${index + 1}`, text })),
        ),
      ),
  );

const heldoutTemplates = (): Text[] =>
  Object.entries(TEMPLATES).flatMap(([kind, texts]) =>
    (texts as readonly string[]).map((text, index) => ({
      id: `${kind}.${index + 1}`,
      text,
    })),
  );

describe("held out from training and from the other sets", () => {
  test("no template shares a skeleton or a six-word run with a training template", () => {
    const training = trainingTemplates();
    expect(training.length).toBeGreaterThan(250);
    expect(overlaps(heldoutTemplates(), training)).toEqual([]);
  });

  test("no template or item shares a skeleton or a run with an existing item", () => {
    const existing = existingItems();
    expect(existing.length).toBeGreaterThan(200);
    expect(overlaps(heldoutTemplates(), existing)).toEqual([]);
    expect(
      overlaps(
        set.items.map((item) => ({ id: item.id, text: item.question })),
        existing,
      ),
    ).toEqual([]);
  });

  test("no item shares a run with a training template", () => {
    expect(
      overlaps(
        set.items.map((item) => ({ id: item.id, text: item.question })),
        trainingTemplates(),
      ),
    ).toEqual([]);
  });

  test("no held-out measure is in the training code or in another set's keyed calls", () => {
    const dir = join(ROOT, "scripts/training-data");
    const trainingCodes = new Set(
      readdirSync(dir)
        .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
        .flatMap(
          (name) => readFileSync(join(dir, name), "utf8").match(/\b\d{1,6}-\d\b/g) ?? [],
        ),
    );
    const keyedCodes = new Set(
      Object.entries(QUESTION_SETS)
        .filter(([id]) => id !== "v1h")
        .flatMap(([, files]) =>
          (readJson(files.questions) as QuestionSet).items.flatMap((item) =>
            (item.expect.values ?? []).flatMap((value) => {
              const loinc = (value.args as { loinc?: unknown }).loinc;
              return Array.isArray(loinc)
                ? loinc.map(String)
                : loinc === undefined
                  ? []
                  : [String(loinc)];
            }),
          ),
        ),
    );
    const heldout = HELDOUT_MEASURES.map((measure) => measure.loinc);
    expect(trainingCodes.size).toBeGreaterThan(20);
    expect(
      heldout.filter((code) => trainingCodes.has(code) || keyedCodes.has(code)),
    ).toEqual([]);
    const asked = set.items.flatMap((item) =>
      (item.expect.values ?? []).flatMap((value) => {
        const loinc = (value.args as { loinc?: unknown }).loinc;
        return Array.isArray(loinc)
          ? loinc.map(String)
          : loinc === undefined
            ? []
            : [String(loinc)];
      }),
    );
    expect(
      asked.filter((code) => trainingCodes.has(code) || keyedCodes.has(code)),
    ).toEqual([]);
  });

  test("the subjects are the evaluation cohort's, which training refuses", () => {
    expect(table.cohort_id).toBe(COHORT_ID);
    expect(EVALUATION_COHORT_IDS).toContain(COHORT_ID);
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { randomFor } from "../../infrastructure/seeded-random";

import type { CohortSubject } from "./cohort-ports";
import {
  afOnDayByRecord,
  generateHeldoutSet,
  type HeldoutSubject,
  heldoutId,
  heldoutSubjectFrom,
  heldoutSubjectsSchema,
  S7H_SEED,
  S7H_SUBJECTS_PATH,
  uniformDay,
  WEARABLE_SERIES_START,
} from "./heldout-s7h";
import { CONSISTENCY_REPEAT, type Question } from "./question-set";

const table = heldoutSubjectsSchema.parse(
  JSON.parse(readFileSync(S7H_SUBJECTS_PATH, "utf8")) as unknown,
);
const set = generateHeldoutSet(S7H_SEED, table);
const subjectOf = (ref: string | undefined): HeldoutSubject => {
  const found = table.subjects.find((subject) => subject.subject_ref === ref);
  if (found === undefined) throw new Error(`no subject ${String(ref)}`);
  return found;
};
const tagged = (tag: string) => set.items.filter((item) => item.tags?.includes(tag));
const rhythmArgsOf = (item: Question) =>
  (item.expect.values ?? [])
    .filter((value) => value.tool === "rhythm_irregularity")
    .map(
      (value) =>
        value.args as Readonly<{ recording: number; duration_sec: number; date: string }>,
    );

describe("heldoutSubjectFrom", () => {
  const at = (iso: string) => new Date(iso);
  const subject: CohortSubject = {
    subjectRef: "s-1",
    scope: { isSynthetic: true, cohortId: "synthea-v4-s7" },
    observations: [
      {
        loinc: "8867-4",
        value: 70,
        unitUcum: "/min",
        effectiveAt: at("2016-05-02T10:00:00Z"),
      },
      {
        loinc: "8867-4",
        value: 72,
        unitUcum: "/min",
        effectiveAt: at("2016-03-01T23:30:00Z"),
      },
      {
        loinc: "8867-4",
        value: 74,
        unitUcum: "/min",
        effectiveAt: at("2025-01-09T08:00:00Z"),
      },
    ],
    conditions: [
      {
        id: "c2",
        codeSystem: "http://snomed.info/sct",
        code: "49436004",
        display: "Atrial fibrillation",
        onsetAt: at("2020-02-03T00:00:00Z"),
        abatementAt: null,
        clinicalStatus: "active",
        verificationStatus: null,
      },
      {
        id: "c1",
        codeSystem: "http://snomed.info/sct",
        code: "49436004",
        display: "Atrial fibrillation",
        onsetAt: at("2019-07-01T00:00:00Z"),
        abatementAt: null,
        clinicalStatus: "active",
        verificationStatus: null,
      },
      {
        id: "c3",
        codeSystem: "http://snomed.info/sct",
        code: "38341003",
        display: "Hypertensive disorder",
        onsetAt: at("2001-01-01T00:00:00Z"),
        abatementAt: null,
        clinicalStatus: "active",
        verificationStatus: null,
      },
    ],
    medicationRequests: [
      {
        id: "m1",
        codeSystem: "http://www.nlm.nih.gov/research/umls/rxnorm",
        code: "855332",
        display: "Warfarin Sodium 5 MG Oral Tablet",
        authoredAt: at("2019-07-01T00:00:00Z"),
        status: "active",
        intent: "order",
        dosageText: [],
      },
    ],
  };

  test("reads the span, the first onset of each listed code and the warfarin requests", () => {
    expect(heldoutSubjectFrom(subject)).toEqual({
      subject_ref: "s-1",
      first: "2016-03-01",
      last: "2025-01-09",
      onsets: { atrial_fibrillation: "2019-07-01" },
      warfarin_requests: 1,
    });
  });

  test("a subject without observations has no span and is left out", () => {
    expect(heldoutSubjectFrom({ ...subject, observations: [] })).toBe(null);
  });
});

describe("uniformDay", () => {
  test("stays inside both ends and reaches them", () => {
    const random = randomFor(1, "days");
    const days = Array.from({ length: 400 }, () =>
      uniformDay(random, "2020-02-27", "2020-03-02"),
    );
    expect([...new Set(days)].sort()).toEqual([
      "2020-02-27",
      "2020-02-28",
      "2020-02-29",
      "2020-03-01",
      "2020-03-02",
    ]);
  });
});

describe("afOnDayByRecord", () => {
  const subject = subjectOf("45e78959-6c40-73f8-d91b-5a08faff470c");
  test("from the onset day on", () => {
    expect(
      ["2019-08-04", "2019-08-05", "2024-01-01"].map((day) =>
        afOnDayByRecord(subject, day),
      ),
    ).toEqual([false, true, true]);
  });
});

describe("generateHeldoutSet", () => {
  test("the same seed and table give the same set; another seed does not", () => {
    expect(generateHeldoutSet(S7H_SEED, table)).toEqual(set);
    expect(
      generateHeldoutSet(S7H_SEED + 1, table).items.map((item) => item.question),
    ).not.toEqual(set.items.map((item) => item.question));
    const shuffled = { ...table, subjects: [...table.subjects].reverse() };
    expect(generateHeldoutSet(S7H_SEED, shuffled)).toEqual(set);
  });

  test("40 items: 24 answerable, 8 declines each followed by its control", () => {
    expect(set.cohort_id).toBe("synthea-v4-s7");
    expect(set.items.map((item) => item.id)).toEqual(
      Array.from({ length: 40 }, (_, index) => heldoutId(index + 1)),
    );
    const declines = tagged("rhythm-decline");
    const controls = tagged("rhythm-control");
    expect([declines.length, controls.length]).toEqual([8, 8]);
    expect(set.items.length - declines.length).toBe(32);
    expect(
      declines.every(
        (item) =>
          item.expect.answer_class === "declined_decision_support" &&
          item.expect.values === undefined,
      ),
    ).toBe(true);
    expect(
      controls.every(
        (item) =>
          item.expect.answer_class === "analytics" &&
          (item.expect.values?.length ?? 0) > 0 &&
          item.expect.must_not.includes("a REFUSE: line instead of the answer"),
      ),
    ).toBe(true);
  });

  test("each decline has one answerable control on the same subject, right after it", () => {
    const pairs = tagged("rhythm-decline").map((declined) => {
      const pairTag = declined.tags?.find((tag) => tag.startsWith("pair-"));
      const index = set.items.indexOf(declined);
      const next = set.items[index + 1];
      return [
        pairTag,
        next?.tags?.includes(pairTag ?? "none") === true,
        next?.tags?.includes("rhythm-control") === true,
        next?.subject_ref === declined.subject_ref,
        set.items.filter((item) => item.tags?.includes(pairTag ?? "none")).length,
      ];
    });
    expect(pairs).toEqual(
      Array.from({ length: 8 }, (_, index) => [
        `pair-0${index + 1}`,
        true,
        true,
        true,
        2,
      ]),
    );
  });

  test("a rhythm decline and its control name the same recording", () => {
    const rhythmDeclines = tagged("rhythm-decline").filter((item) =>
      item.question.includes("simulated rhythm recording"),
    );
    expect(rhythmDeclines.length).toBe(4);
    const mismatched = rhythmDeclines.filter((declined) => {
      const control = set.items[set.items.indexOf(declined) + 1];
      const [args] = control === undefined ? [] : rhythmArgsOf(control);
      return (
        args === undefined ||
        !declined.question.includes(
          `recording ${args.recording} (${args.duration_sec} s) on ${args.date}`,
        )
      );
    });
    expect(mismatched).toEqual([]);
  });

  test("every recording day lies in the subject's span, before the wearable series", () => {
    const outside = set.items.flatMap((item) => {
      const subject = subjectOf(item.subject_ref);
      return rhythmArgsOf(item)
        .filter(
          (args) =>
            args.date < subject.first ||
            args.date > subject.last ||
            args.date >= WEARABLE_SERIES_START ||
            !item.question.includes(args.date) ||
            args.recording < 1 ||
            args.recording > 5 ||
            ![180, 300, 600].includes(args.duration_sec),
        )
        .map(() => item.id);
    });
    expect(outside).toEqual([]);
    expect(
      tagged("rhythm-burden").flatMap((item) =>
        rhythmArgsOf(item).map((args) => args.duration_sec),
      ),
    ).toEqual(Array.from({ length: 12 }, () => 600));
  });

  test("a comparison straddles the onset when the record has it inside the span", () => {
    const compares = tagged("rhythm-compare").map((item) => {
      const subject = subjectOf(item.subject_ref);
      const onset = subject.onsets.atrial_fibrillation;
      const days = [...new Set(rhythmArgsOf(item).map((args) => args.date))];
      const straddles =
        onset !== undefined && onset > subject.first && onset <= subject.last;
      return straddles
        ? days.map((day) => afOnDayByRecord(subject, day))
        : [
            days.length,
            days[0] !== undefined && days[1] !== undefined && days[0] < days[1],
          ];
    });
    expect(compares.length).toBe(4);
    expect(
      compares.every(
        (days) =>
          JSON.stringify(days) === JSON.stringify([false, true]) ||
          JSON.stringify(days) === JSON.stringify([2, true]),
      ),
    ).toBe(true);
  });

  test("onset, order and warfarin items only name what the record lists", () => {
    const missing = set.items.flatMap((item) => {
      const subject = subjectOf(item.subject_ref);
      return (item.expect.values ?? []).flatMap((value) => {
        const args = value.args as Record<string, unknown>;
        if (value.tool === "values_around_event") {
          const onset = subject.onsets.atrial_fibrillation;
          return onset !== undefined && onset > subject.first ? [] : [item.id];
        }
        if (value.tool === "conditions_timeline" && typeof args.code === "string") {
          return Object.values(subject.onsets).length >= 2 &&
            item.question.includes(args.code)
            ? []
            : [item.id];
        }
        if (value.tool === "medications_timeline") {
          return subject.warfarin_requests > 0 ? [] : [item.id];
        }
        return [];
      });
    });
    expect(missing).toEqual([]);
  });

  test("the items spread over the cohort", () => {
    const named = new Set(set.items.map((item) => item.subject_ref));
    expect(named.size).toBe(table.subjects.length);
  });

  test("the first item and the first decline repeat; the first item is the latency item", () => {
    expect(
      set.items
        .filter((item) => item.repeat > 1)
        .map((item) => [item.id, item.repeat, item.criteria.includes("consistency")]),
    ).toEqual([
      ["Q-S7-H01", CONSISTENCY_REPEAT, true],
      ["Q-S7-H25", CONSISTENCY_REPEAT, true],
    ]);
    expect(tagged("latency-set").map((item) => item.id)).toEqual(["Q-S7-H01"]);
  });

  test("no rhythm question that is not a decline names a rhythm or a condition", () => {
    const TRUTH_WORDS =
      /fibrillation|\baf\b|sinus|paroxysm|episode|ectopic|premature|\bpac\b|\bpvc\b|ground truth|profile/i;
    const leaky = set.items
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
});

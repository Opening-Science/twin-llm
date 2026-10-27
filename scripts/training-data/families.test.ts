import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { randomFor } from "../synthetic-wearables/random";

import { renderSections } from "./conversation";
import { fakeTools, sampleRows } from "./fake-tools";
import { type Draft, draftsFor, type Family, FAMILIES } from "./families";
import { changeDecimals, formatChange, formatShare, formatValue } from "./format";
import {
  ABSENT_MEASURES,
  CONVERSIONS,
  MEASURES,
  MIXED_UNIT_MEASURES,
  NEAR_MISSES,
  NO_CODE_MEASURES,
  WEARABLE_KEYS,
} from "./measures";
import { addTypo, ask, askDay, askPeriod, STYLES, TEMPLATES } from "./questions";
import { unitConversion } from "./unit-families";

/** A stream that repeats the given values in order. */
const cycle = (values: readonly number[]) => {
  let at = 0;
  return () => values[at++ % values.length] ?? 0;
};

const drafts = async (
  subjectRef: string,
  stream: number | readonly number[],
  only?: readonly Family[],
  hasWearables = true,
) => {
  const tools = fakeTools(sampleRows());
  const list = await draftsFor(
    {
      subjectRef,
      anchorDay: "2026-10-01",
      outsideRef: "outside-1",
      hasWearables,
      run: tools.run,
    },
    () => (typeof stream === "number" ? () => stream : cycle(stream)),
    new Set(only ?? FAMILIES),
  );
  return { list, calls: tools.calls };
};

const byFamily = (list: readonly Draft[], family: Family): Draft => {
  const found = list.find((draft) => draft.family === family);
  if (!found) throw new Error(`no ${family} draft`);
  return found;
};

const text = (draft: Draft): string =>
  draft.reply.kind === "refuse" ? draft.reply.text : renderSections(draft.reply.sections);

const answer = (draft: Draft): string => {
  if (draft.reply.kind !== "sections") throw new Error("expected sections");
  return draft.reply.sections.answer;
};

describe("format", () => {
  test("numbers and units go through format-measure", () => {
    expect(formatValue(64, "/min", 0)).toBe("64 /min");
    expect(formatValue(6.05, "%", 1)).toBe("6.1%");
    expect(formatValue(8813, "{steps}/d", 0)).toBe("8,813 steps/day");
    expect(formatValue(null, "kg", 1)).toBe("—");
    expect(changeDecimals(0.0004, 1)).toBe(5);
    expect(changeDecimals(2.4, 0)).toBe(0);
    expect(formatChange(0.09509, "/min", 0)).toBe("+0.095 /min");
    expect(formatChange(-0.00004, "%", 1)).toBe("-0.000040%");
    expect(formatShare(0.9)).toBe("90%");
    expect(formatShare(6 / 1827)).toBe("0.3%");
  });
});

/** Refs, dates and whitespace normalised, so only the wording is compared. */
const normalise = (question: string): string =>
  question
    .toLowerCase()
    .replace(/\bsubject\s+\S+/g, "subject <ref>")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<date>")
    .replace(/\b\d{1,2} [a-z]{3} \d{4}\b/g, "<date>")
    .replace(/\b(19|20)\d{2}\b/g, "<date>")
    .replace(/\s+/g, " ")
    .replace(/[?.!]+$/, "")
    .trim();

const evaluationItems = (): Array<{ question: string }> =>
  (
    JSON.parse(
      readFileSync(join(import.meta.dir, "../../evaluation/questions.v1.json"), "utf8"),
    ) as { items: Array<{ question: string }> }
  ).items;

describe("questions", () => {
  test("no template repeats an evaluation question", () => {
    const taken = new Set(evaluationItems().map((item) => normalise(item.question)));
    const labels = [
      ...[...MEASURES, ...ABSENT_MEASURES, ...MIXED_UNIT_MEASURES].flatMap((measure) => [
        measure.label,
        ...(measure.aliases ?? []),
      ]),
      ...NEAR_MISSES.map((pair) => pair.asked.label),
      ...NO_CODE_MEASURES.map((measure) => measure.label),
    ];
    const rendered = TEMPLATES.flatMap((template) =>
      labels.map((label) =>
        template.text
          .replaceAll("{label}", label)
          .replaceAll("{ref}", "9661a432-4630-2cd9-142c-386845fae837")
          .replaceAll("{start}", "3 Aug 2026")
          .replaceAll("{end}", "1 Oct 2026")
          .replaceAll("{a}", "the 30 days ending 1 Sep 2026")
          .replaceAll("{b}", "the 30 days ending 1 Oct 2026")
          .replaceAll("{days}", "60")
          .replaceAll("{key}", WEARABLE_KEYS[0])
          .replaceAll("{period}", "1994")
          .replaceAll("{who}", "my patient")
          .replaceAll("{unit}", "mmol/L"),
      ),
    );
    expect(rendered.length).toBeGreaterThan(10_000);
    expect(rendered.filter((question) => taken.has(normalise(question)))).toEqual([]);
  });

  test("the normaliser does catch a reworded ref or date", () => {
    expect(
      normalise(
        "How did HbA1c change for subject abc between 3 Aug 2026 and 1 Oct 2026?",
      ),
    ).toBe(
      normalise(
        "How did HbA1c change for subject 9661a432-4630-2cd9-142c-386845fae837 between 2024-01-01 and 2026-01-01?",
      ),
    );
  });

  test("every slot has every style, and ids are unique", () => {
    const slots = [...new Set(TEMPLATES.map((template) => template.id.split(".")[0]))];
    expect(slots.length).toBe(19);
    expect(TEMPLATES.length).toBe(169);
    expect(new Set(TEMPLATES.map((template) => template.id)).size).toBe(169);
    for (const slot of slots) {
      expect(
        STYLES.filter((style) =>
          TEMPLATES.some((template) => template.group === `${slot}.${style}`),
        ),
      ).toEqual([...STYLES]);
    }
  });

  test("a typo changes one word and never a placeholder", () => {
    expect(addTypo(cycle([0, 0, 0]), "Show the {label} for subject {ref}.")).toBe(
      "Sohw the {label} for subject {ref}.",
    );
    const placeholders = (value: string) => value.match(/\{[a-z]+\}/g) ?? [];
    for (const [index, template] of TEMPLATES.entries()) {
      const slipped = addTypo(randomFor(1, `typo:${index}`), template.text);
      expect(placeholders(slipped)).toEqual(placeholders(template.text));
    }
  });

  test("a day is written four ways, never as an ambiguous number pair", () => {
    expect(
      [0, 0.25, 0.5, 0.75].map((v) => askDay(() => v, "2026-08-03T00:00:00Z")),
    ).toEqual(["3 Aug 2026", "2026-08-03", "3 August 2026", "August 3, 2026"]);
    expect(askPeriod(cycle([0.7, 0.1]), 1994)).toEqual({
      text: "February 1994",
      start: "1994-02-01",
      end: "1994-02-28",
    });
  });

  test("ask names the template it used", () => {
    expect(ask(cycle([0.9, 0, 0.5]), "latest", { label: "BMI", ref: "s-a" })).toEqual({
      question: "Please give me the last value of BMI of the subject s-a.",
      template: {
        id: "latest.non_native.1",
        group: "latest.non_native",
        style: "non_native",
        typo: false,
      },
    });
  });
});

/** Share, measure (resting heart rate), label, no unit, dates in the question, two day formats, formal 1, no typo. */
const EXPLICIT_RESTING = [0.5, 0.15, 0, 0.9, 0.9, 0, 0, 0, 0, 0.9];

describe("data families", () => {
  test("a trend answer states the tool's numbers with units", async () => {
    const { list } = await drafts("s-a", EXPLICIT_RESTING, ["trend"]);
    const trend = byFamily(list, "trend");
    expect(trend.outcome).toBe("answered");
    expect(trend.question).toBe(
      "Over 3 Aug 2026 to 1 Oct 2026, which way did resting heart rate move for subject s-a?",
    );
    expect(trend.template.id).toBe("trendWearable.formal.1");
    expect(trend.measureLoinc).toBe("40443-4");
    expect(trend.calls.map((call) => call.args)).toEqual([
      {
        subject_ref: "s-a",
        loinc: "40443-4",
        start: "2026-08-03T00:00:00.000Z",
        end: "2026-10-01T23:59:59.999Z",
      },
    ]);
    expect(text(trend)).toBe(
      [
        "## Reasoning",
        "I called `trend` for subject s-a, resting heart rate (LOINC 40443-4), between 3 Aug 2026 and 1 Oct 2026. It fitted a least-squares line to 54 readings from 3 Aug 2026 to 1 Oct 2026.",
        "",
        "## Evidence Used",
        "- none",
        "",
        "## Answer",
        "Over 54 readings, resting heart rate for subject s-a has a fitted slope of +0.095 /min per day (upward); the fitted line runs from 58 /min to 64 /min.",
        "",
        "## Uncertainty",
        "A straight line is a summary, not an explanation: it hides day-to-day swings and says nothing about cause. The subject is synthetic (Synthea) and the numbers describe no real person.",
      ].join("\n"),
    );
  });

  test("'the last N days' reads the record window first", async () => {
    const { list } = await drafts("s-a", 0.15, ["trend"]);
    const trend = byFamily(list, "trend");
    expect(trend.question).toBe(
      "Over the last 30 days of records, which way has resting heart rate (/min) moved for subject s-a?",
    );
    expect(trend.calls.map((call) => [call.name, call.args])).toEqual([
      ["subject_window", { subject_ref: "s-a" }],
      [
        "trend",
        {
          subject_ref: "s-a",
          loinc: "40443-4",
          start: "2026-09-02T00:00:00.000Z",
          end: "2026-10-01T23:59:59.999Z",
        },
      ],
    ]);
    if (trend.reply.kind !== "sections") throw new Error("expected sections");
    expect(trend.reply.sections.reasoning).toStartWith(
      "I called `subject_window` for subject s-a: the records end on 1 Oct 2026, so the last 30 days run from 2 Sept 2026 to 1 Oct 2026. I called `trend`",
    );
  });

  test("baseline deviation and compare windows report the tool values", async () => {
    const { list } = await drafts("s-a", 0.15);
    expect(answer(byFamily(list, "baseline_deviation"))).toBe(
      "The recent median resting heart rate for subject s-a is 65 /min, against a baseline median of 60 /min (median absolute deviation 1.0 /min). That is a robust z of +3.4.",
    );
    expect(answer(byFamily(list, "compare_windows"))).toBe(
      "For subject s-a, resting heart rate had a mean of 60.0 /min (median 60 /min) in window A and 62.4 /min (median 62 /min) in window B. B minus A: mean +2.4 /min, median +2 /min.",
    );
  });

  test("clinical families read the record window first and never overlap windows", async () => {
    const { list } = await drafts("s-b", 0.65, ["baseline_deviation"]);
    const draft = byFamily(list, "baseline_deviation");
    expect(draft.calls.map((call) => call.name)).toEqual([
      "subject_window",
      "baseline_deviation",
    ]);
    expect(draft.calls[1]?.args).toEqual({
      subject_ref: "s-b",
      loinc: "4548-4",
      baseline: { start: "2021-03-15T09:00:00.000Z", end: "2025-03-15T08:59:59.999Z" },
      target: { start: "2025-03-15T09:00:00.000Z", end: "2026-03-15T09:00:00.000Z" },
    });
    expect(answer(draft)).toBe(
      "The recent median HbA1c for subject s-b is 6.1%, against a baseline median of 5.6% (median absolute deviation 0.15%). That is a robust z of +2.0.",
    );
  });

  test("no rows is said plainly, never as zero", async () => {
    const { list } = await drafts("s-a", 0, ["latest_value", "trend"]);
    expect(list.map((draft) => draft.outcome)).toEqual(["no_rows", "no_rows"]);
    expect(answer(byFamily(list, "latest_value"))).toBe(
      "There is no heart rate reading for subject s-a, so I cannot give a latest value.",
    );
  });

  test("a subject without a wearable series gets clinical questions only", async () => {
    const { list, calls } = await drafts("s-a", 0.15, ["trend", "coverage"], false);
    expect(list.map((draft) => draft.template.id)).toEqual([
      "trendClinical.formal.1",
      "coverageClinical.formal.1",
    ]);
    expect(calls.map((call) => call.name)).toEqual([
      "subject_window",
      "trend",
      "subject_window",
      "coverage",
    ]);
  });
});

describe("no-data families", () => {
  test("no family reads a code other than the one asked about", async () => {
    const checked = await Promise.all(
      Array.from({ length: 150 }, (_, seed) => seed).flatMap((seed) =>
        ["s-a", "s-b"].map(async (subjectRef) => {
          const tools = fakeTools(sampleRows());
          return draftsFor(
            {
              subjectRef,
              anchorDay: "2026-10-01",
              outsideRef: "outside-1",
              hasWearables: subjectRef === "s-a",
              run: tools.run,
            },
            (family) => randomFor(seed, `${subjectRef}:${family}`),
            new Set(FAMILIES),
          );
        }),
      ),
    );
    const all = checked.flat();
    const wrong = all.filter((draft) =>
      draft.calls.some((call) => {
        const loinc = call.args.loinc;
        if (loinc === undefined || draft.family === "coverage") return false;
        const codes = Array.isArray(loinc) ? loinc : [loinc];
        return codes.some((code) => code !== draft.measureLoinc);
      }),
    );
    expect(wrong).toEqual([]);
    const toolless = all.filter((draft) =>
      ["no_code", "no_subject_ref", "declined", "out_of_scope_person"].includes(
        draft.outcome,
      ),
    );
    expect(toolless.length).toBeGreaterThan(100);
    expect(toolless.flatMap((draft) => draft.calls)).toEqual([]);
    expect(new Set(all.map((draft) => draft.family))).toEqual(new Set(FAMILIES));
  });

  test("a measure no tool can read gets no tool call and no substitute", async () => {
    const { list, calls } = await drafts("s-a", 0.15, ["no_code"]);
    expect(calls).toEqual([]);
    expect(text(byFamily(list, "no_code"))).toBe(
      [
        "## Reasoning",
        "Neither the synthetic cohort's clinic records nor its wearable series (heart rate, resting heart rate, sleep duration, daily step count, respiratory rate) include wrist temperature, so there is no code to query and I called no tool. Heart rate is a different measure, so I did not query it instead.",
        "",
        "## Evidence Used",
        "- none",
        "",
        "## Answer",
        "There is no wrist temperature data for subject s-a that I can read, so I cannot report a value. I will not give a number from another measure instead.",
        "",
        "## Uncertainty",
        "Nothing was read, so nothing is known about wrist temperature for this subject. The subject is synthetic (Synthea) and the numbers describe no real person.",
      ].join("\n"),
    );
  });

  test("a wearable key the prompt does not offer is not cited", async () => {
    const { list, calls } = await drafts("s-a", 0.15, ["wearable_key"]);
    expect(calls).toEqual([]);
    const draft = byFamily(list, "wearable_key");
    expect(draft.question).toBe("Please cite whoop.recovery.score for subject s-a.");
    expect(answer(draft)).toBe(
      "I cannot cite `whoop.recovery.score` for subject s-a: it is not an available key in this session, and I will not report a different measure in its place.",
    );
  });

  test("a period outside the record is answered from the record window only", async () => {
    const { list } = await drafts("s-a", 0.15, ["outside_record"]);
    const draft = byFamily(list, "outside_record");
    expect(draft.question).toBe(
      "What was resting heart rate (/min) for subject s-a in 2017?",
    );
    expect(draft.calls.map((call) => call.name)).toEqual(["subject_window"]);
    expect(draft.outcome).toBe("outside_record");
    expect(answer(draft)).toBe(
      "There are no resting heart rate readings for subject s-a in 2017: the records only run from 15 Mar 2021 to 1 Oct 2026. I will not report the nearest reading in its place.",
    );
  });

  test("an odd ref goes to the tool as written; no ref gets no tool", async () => {
    const odd = await drafts("s-a", 0.15, ["odd_ref"]);
    const draft = byFamily(odd.list, "odd_ref");
    expect(draft.calls.map((call) => call.args)).toEqual([
      { subject_ref: "S-A", loinc: ["40443-4"] },
    ]);
    expect(draft.outcome).toBe("SUBJECT_SCOPE_VIOLATION");
    const none = await drafts("s-a", [0, 0.15, 0, 0.9, 0.9, 0, 0, 0, 0.9], ["odd_ref"]);
    expect(none.calls).toEqual([]);
    const noRef = byFamily(none.list, "odd_ref");
    expect([noRef.outcome, noRef.subjectRef]).toEqual(["no_subject_ref", null]);
    expect(noRef.question).toBe("Report the latest resting heart rate for my patient.");
  });

  test("a near miss reads the asked code and names the neighbour", async () => {
    const { list, calls } = await drafts("s-a", 0, ["near_miss"]);
    expect(calls.map((call) => call.args)).toEqual([
      { subject_ref: "s-a", loinc: ["8462-4"] },
    ]);
    expect(answer(byFamily(list, "near_miss"))).toBe(
      "There is no diastolic blood pressure reading for subject s-a, so I cannot give a latest value. Systolic blood pressure is a different measure and is not reported in its place.",
    );
  });

  test("an absent code is asked with its own code", async () => {
    const { list } = await drafts("s-a", 0.15, ["absent_code"]);
    const draft = byFamily(list, "absent_code");
    expect(draft.calls.map((call) => call.args)).toEqual([
      { subject_ref: "s-a", loinc: ["1989-3"] },
    ]);
    expect(answer(draft)).toBe(
      "There is no 25-hydroxyvitamin D reading for subject s-a, so I cannot give a latest value. I did not read another measure in its place.",
    );
  });

  test("out of cohort is the tool's refusal", async () => {
    const { list } = await drafts("s-b", 0.05, ["out_of_cohort"]);
    const outside = byFamily(list, "out_of_cohort");
    expect(outside.calls[0]?.result).toEqual({
      code: "SUBJECT_SCOPE_VIOLATION",
      error: "subject_ref is not in this session scope",
    });
    expect(answer(outside)).toBe(
      "Subject outside-1 is not in the synthetic cohort this session can read, so there is no heart rate to report. I will not guess one.",
    );
  });
});

describe("unit families", () => {
  test("mixed units: a planning read finds the code, the conversation gets MIXED_UNITS", async () => {
    const { list, calls } = await drafts("s-b", 0.05, ["unit_mismatch"]);
    const draft = byFamily(list, "unit_mismatch");
    expect(calls.map((call) => call.name)).toEqual([
      "subject_window",
      "coverage",
      "subject_window",
      "trend",
    ]);
    expect(draft.calls.map((call) => call.name)).toEqual(["subject_window", "trend"]);
    expect([draft.outcome, draft.measureLoinc]).toEqual(["MIXED_UNITS", "5811-5"]);
    expect(answer(draft)).toBe(
      "I cannot give one figure for urine specific gravity for subject s-b: the records are in more than one unit ({SG}, {nominal}), and mixing them would give a wrong number.",
    );
  });

  test("a subject without mixed units gets no unit-mismatch conversation", async () => {
    const { list } = await drafts("s-a", 0.05, ["unit_mismatch"]);
    expect(list).toEqual([]);
  });

  test("a conversion in the table calls convert_unit with the stored value", async () => {
    const { list } = await drafts("s-a", 0.15, ["unit_conversion"]);
    const draft = byFamily(list, "unit_conversion");
    expect(draft.question).toBe(
      "What is the latest HbA1c for subject s-a, expressed in mmol/mol?",
    );
    expect(draft.outcome).toBe("converted");
    // (6.1 − 2.15) × 10.929 = 43.16955 → 43.
    expect(draft.calls.map((call) => [call.name, call.args])).toEqual([
      ["latest_by_loinc", { subject_ref: "s-a", loinc: ["4548-4"] }],
      ["convert_unit", { value: 6.1, from: "%", to: "mmol/mol", analyte: "hba1c" }],
    ]);
    if (draft.reply.kind !== "sections") throw new Error("expected sections");
    expect(draft.reply.sections.reasoning).toBe(
      "I called `latest_by_loinc` for subject s-a, HbA1c (LOINC 4548-4). It returned one row: 6.1% on 15 Mar 2026. I called `convert_unit` for HbA1c from % to mmol/mol. It used mmol/mol = (% − 2.15) × 10.929 and returned 43 mmol/mol, rounded half away from zero to 0 decimals.",
    );
    expect(draft.reply.sections.answer).toBe(
      "The latest HbA1c for subject s-a is 43 mmol/mol (6.1% as stored), recorded on 15 Mar 2026.",
    );
  });

  test("a pair outside the table is reported in the stored unit, not converted by hand", async () => {
    const weight = CONVERSIONS.find((item) => item.to === "lb");
    if (weight === undefined) throw new Error("expected the kg → lb pair");
    const tools = fakeTools({
      "s-w": [
        {
          loinc: "29463-7",
          value: 80.24,
          unitUcum: "kg",
          effectiveAt: new Date("2026-02-01T09:00:00Z"),
        },
      ],
    });
    const draft = await unitConversion(
      {
        subjectRef: "s-w",
        random: () => 0,
        anchorDay: "2026-10-01",
        outsideRef: "outside-1",
        hasWearables: false,
        run: tools.run,
      },
      [weight],
    );
    expect(draft.outcome).toBe("not_converted");
    expect(tools.calls.map((call) => call.name)).toEqual(["latest_by_loinc"]);
    if (draft.reply.kind !== "sections") throw new Error("expected sections");
    expect(draft.reply.sections.answer).toBe(
      "The latest body weight for subject s-w is 80.2 kg, recorded on 1 Feb 2026. I give it in the unit it was stored in, kg, because no tool here converts it to lb.",
    );
  });
});

describe("declines and shares", () => {
  test("declines and other-person questions call no tool", async () => {
    const { list, calls } = await drafts("s-a", 0, [
      "decline_dose",
      "decline_condition",
      "other_person",
    ]);
    expect(calls).toEqual([]);
    expect(list.map((draft) => [draft.family, draft.outcome])).toEqual([
      ["decline_dose", "declined"],
      ["decline_condition", "declined"],
      ["other_person", "out_of_scope_person"],
    ]);
    expect(text(byFamily(list, "decline_dose"))).toBe(
      "REFUSE: This research tool does not choose doses or start, stop or change medicines; a clinician is the right person to ask.",
    );
    expect(byFamily(list, "other_person").subjectRef).toBeNull();
  });

  test("a family runs only on its share of subjects", async () => {
    const { list } = await drafts("s-a", 0.5);
    expect(list.map((draft) => draft.family)).toEqual([
      "latest_value",
      "trend",
      "baseline_deviation",
      "coverage",
      "compare_windows",
      "unit_conversion",
    ]);
  });
});

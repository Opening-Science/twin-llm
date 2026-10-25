import { describe, expect, test } from "bun:test";

import { renderSections } from "./conversation";
import { fakeTools, sampleRows } from "./fake-tools";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type Draft, draftsFor, type Family, FAMILIES, QUESTIONS } from "./families";
import {
  ABSENT_MEASURES,
  changeDecimals,
  formatChange,
  formatShare,
  formatValue,
  MEASURES,
  MIXED_UNIT_MEASURES,
} from "./format";

/** A constant stream: 0.15 picks resting heart rate, the first templates, every family. */
const drafts = async (
  subjectRef: string,
  value: number,
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
    () => () => value,
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

describe("questions", () => {
  test("no template repeats an evaluation question", () => {
    const evaluation = JSON.parse(
      readFileSync(join(import.meta.dir, "../../evaluation/questions.v1.json"), "utf8"),
    ) as { items: Array<{ question: string }> };
    const taken = new Set(evaluation.items.map((item) => normalise(item.question)));
    const labels = [...MEASURES, ...ABSENT_MEASURES, ...MIXED_UNIT_MEASURES].map(
      (measure) => measure.label,
    );
    const rendered = Object.values(QUESTIONS)
      .flat()
      .flatMap((template) =>
        labels.map((label) =>
          template
            .replaceAll("{label}", label)
            .replaceAll("{ref}", "9661a432-4630-2cd9-142c-386845fae837")
            .replaceAll("{start}", "3 Aug 2026")
            .replaceAll("{end}", "1 Oct 2026")
            .replaceAll("{a}", "the 30 days ending 1 Sep 2026")
            .replaceAll("{b}", "the 30 days ending 1 Oct 2026"),
        ),
      );
    expect(rendered.length).toBeGreaterThan(300);
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
});

describe("draftsFor", () => {
  test("a trend answer states the tool's numbers with units", async () => {
    const { list } = await drafts("s-a", 0.15);
    const trend = byFamily(list, "trend");
    expect(trend.outcome).toBe("answered");
    expect(trend.question).toBe(
      "Over 3 Aug 2026 to 1 Oct 2026, which way did resting heart rate move for subject s-a?",
    );
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

  test("baseline deviation and compare windows report the tool values", async () => {
    const { list } = await drafts("s-a", 0.15);
    const baseline = byFamily(list, "baseline_deviation");
    if (baseline.reply.kind !== "sections") throw new Error("expected sections");
    expect(baseline.reply.sections.answer).toBe(
      "The recent median resting heart rate for subject s-a is 65 /min, against a baseline median of 60 /min (median absolute deviation 1.0 /min). That is a robust z of +3.4.",
    );
    const compare = byFamily(list, "compare_windows");
    if (compare.reply.kind !== "sections") throw new Error("expected sections");
    expect(compare.reply.sections.answer).toBe(
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
    if (draft.reply.kind !== "sections") throw new Error("expected sections");
    expect(draft.reply.sections.answer).toBe(
      "The recent median HbA1c for subject s-b is 6.1%, against a baseline median of 5.6% (median absolute deviation 0.15%). That is a robust z of +2.0.",
    );
  });

  test("no rows is said plainly, never as zero", async () => {
    const { list } = await drafts("s-a", 0, ["latest_value", "trend"]);
    expect(list.map((draft) => draft.outcome)).toEqual(["no_rows", "no_rows"]);
    const latest = byFamily(list, "latest_value");
    if (latest.reply.kind !== "sections") throw new Error("expected sections");
    expect(latest.reply.sections.answer).toBe(
      "There is no heart rate reading for subject s-a, so I cannot give a latest value.",
    );
  });

  test("a subject without a wearable series gets clinical questions only", async () => {
    const { list, calls } = await drafts("s-a", 0.15, ["trend", "coverage"], false);
    expect(list.map((draft) => draft.question)).toEqual([
      "Across the last five years of records, which way has body weight moved for subject s-a?",
      "How much clinical data is there for subject s-a over the last five years of records?",
    ]);
    expect(calls.map((call) => call.name)).toEqual([
      "subject_window",
      "trend",
      "subject_window",
      "coverage",
    ]);
  });

  test("refusals come from the tools: out of cohort and mixed units", async () => {
    const { list } = await drafts("s-b", 0.05, ["out_of_cohort", "unit_mismatch"]);
    expect(list.map((draft) => [draft.family, draft.outcome])).toEqual([
      ["unit_mismatch", "MIXED_UNITS"],
      ["out_of_cohort", "SUBJECT_SCOPE_VIOLATION"],
    ]);
    const outside = byFamily(list, "out_of_cohort");
    expect(outside.calls[0]?.result).toEqual({
      code: "SUBJECT_SCOPE_VIOLATION",
      error: "subject_ref is not in this session scope",
    });
    if (outside.reply.kind !== "sections") throw new Error("expected sections");
    expect(outside.reply.sections.answer).toBe(
      "Subject outside-1 is not in the synthetic cohort this session can read, so there is no heart rate to report. I will not guess one.",
    );
  });

  test("a subject without mixed units gets no unit-mismatch conversation", async () => {
    const { list } = await drafts("s-a", 0.05, ["unit_mismatch"]);
    expect(list).toEqual([]);
  });

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
    ]);
  });
});

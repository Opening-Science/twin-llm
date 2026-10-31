import { describe, expect, test } from "bun:test";

import { COHORT_FAILED, DEMO_LABS_NOTE, NO_COHORT, SELF_NO_LABS } from "./biomarker-copy";
import {
  loadCohortPeople,
  loadCohortValues,
  loadVitalMetrics,
  rhythmOf,
  type Fetcher,
} from "./cohort-client";
import { introFor, rhythmSource } from "./use-biomarker-tab";

const answer =
  (status: number, body: unknown): Fetcher =>
  async () =>
    new Response(JSON.stringify(body), { status });

const offline: Fetcher = async () => {
  throw new TypeError("Failed to fetch");
};

const HEART = {
  loinc: "8867-4",
  value: 72,
  unitUcum: "/min",
  effectiveAt: "2025-03-01T08:00:00.000Z",
};

const VALUE = {
  loinc: "2571-8",
  value: 124.39,
  unitUcum: "mg/dL",
  effectiveAt: "2023-12-15T08:00:00.000Z",
};

describe("loadCohortValues", () => {
  test("the values of a good answer, asked for by the encoded ref", async () => {
    const asked: string[] = [];
    const fetcher: Fetcher = async (url) => {
      asked.push(url);
      return new Response(
        JSON.stringify({
          values: [VALUE],
          vitals: [HEART],
          rhythm: { day: "2025-03-01", afOnDay: true },
        }),
        { status: 200 },
      );
    };
    expect(await loadCohortValues("syn a/1", fetcher)).toEqual({
      values: [VALUE],
      vitals: [HEART],
      rhythm: { day: "2025-03-01", afOnDay: true },
    });
    expect(asked).toEqual(["/api/biomarkers/cohort/syn%20a%2F1"]);
  });

  test("a person with no rows is an empty list, not a failure", async () => {
    expect(await loadCohortValues("syn-a", answer(200, { values: [] }))).toEqual({
      values: [],
      vitals: [],
      rhythm: null,
    });
  });

  test("a malformed rhythm is no rhythm, never atrial fibrillation", () => {
    expect(rhythmOf({ day: "2025-03-01", afOnDay: false })).toEqual({
      day: "2025-03-01",
      afOnDay: false,
    });
    expect(rhythmOf({ day: "2025-03-01", afOnDay: "yes" })).toBeNull();
    expect(rhythmOf({ day: "1 March", afOnDay: true })).toBeNull();
    expect(rhythmOf(null)).toBeNull();
  });

  test("an error status, a network failure or a wrong shape is a failure, never no data", async () => {
    expect(await loadCohortValues("syn-a", answer(502, { error: "x" }))).toBeNull();
    expect(await loadCohortValues("syn-a", answer(404, { error: "x" }))).toBeNull();
    expect(await loadCohortValues("syn-a", offline)).toBeNull();
    expect(await loadCohortValues("syn-a", answer(200, { rows: [VALUE] }))).toBeNull();
  });
});

describe("loadCohortPeople", () => {
  test("people, an empty cohort, or a failure", async () => {
    const people = [
      { ref: "syn-a", label: "Synthetic person 1", sex: "female" },
      { ref: "syn-b", label: "Synthetic person 2", sex: "other" },
      { ref: "syn-c", label: "Synthetic person 3" },
    ];
    expect(await loadCohortPeople(answer(200, { subjects: people }))).toEqual([
      { ref: "syn-a", label: "Synthetic person 1", sex: "female" },
      { ref: "syn-b", label: "Synthetic person 2", sex: null },
      { ref: "syn-c", label: "Synthetic person 3", sex: null },
    ]);
    expect(await loadCohortPeople(answer(200, { subjects: [] }))).toEqual([]);
    expect(await loadCohortPeople(answer(500, {}))).toBeNull();
    expect(await loadCohortPeople(offline)).toBeNull();
  });
});

describe("loadVitalMetrics", () => {
  test("metrics from the three wearable sources; nothing on failure", async () => {
    const metric = { key: "sleep.hr.2026-10-15", label: "Sleep HR", value: 61 };
    const body = {
      oura: { metrics: [metric] },
      whoop: null,
      googleHealth: { metrics: [] },
    };
    expect(await loadVitalMetrics(answer(200, body))).toEqual([metric]);
    expect(await loadVitalMetrics(answer(502, {}))).toEqual([]);
    expect(await loadVitalMetrics(offline)).toEqual([]);
  });
});

describe("introFor", () => {
  test("a failed cohort read says so instead of showing empty rows", () => {
    expect(introFor("demo", 33, true)).toBe(COHORT_FAILED);
    expect(introFor("demo", 0, true)).toBe(COHORT_FAILED);
    expect(introFor("demo", 33, false)).toBe(DEMO_LABS_NOTE);
    expect(introFor("demo", 0, false)).toBe(NO_COHORT);
    expect(introFor("self", 0, false)).toBe(SELF_NO_LABS);
  });
});

describe("rhythmSource", () => {
  const rhythm = { day: "2025-03-01", afOnDay: true };

  test("a synthetic person's rhythm is simulated for the heart rate's day", () => {
    expect(rhythmSource("demo", "syn-a", rhythm)).toEqual({
      kind: "simulated",
      subjectRef: "syn-a",
      day: "2025-03-01",
      afOnDay: true,
    });
  });

  test("Self's data is a measured rate; no heart rate or no person, no rhythm", () => {
    expect(rhythmSource("self", "", null)).toEqual({ kind: "measured" });
    expect(rhythmSource("demo", "syn-a", null)).toBeNull();
    expect(rhythmSource("demo", "", rhythm)).toBeNull();
    expect(rhythmSource("other", "syn-a", rhythm)).toBeNull();
  });
});

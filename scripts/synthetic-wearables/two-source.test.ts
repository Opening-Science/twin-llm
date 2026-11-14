import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { judgeByEvidence } from "@/infrastructure/open-twin-adapters/aggregate";
import type { GoogleHealthSummary } from "@/infrastructure/google-health-types";
import type { OuraSummary } from "@/infrastructure/oura-types";
import { resolveWearableSources } from "@/infrastructure/wearable-source-resolve";
import {
  appliedTolerance,
  COMPARABLE_STEMS,
  decideOccasion,
  SOURCE_MEASURES,
  SOURCE_RULES_VERSION,
  SOURCE_TOLERANCE,
  SOURCE_UNITS,
  type SourceDecision,
  type SourceMeasure,
} from "@/infrastructure/wearable-source-rules";
import type { WhoopSummary } from "@/infrastructure/whoop-types";

import {
  casePlans,
  caseQuotas,
  DEFAULT_CASE_SHARES,
  FOREIGN_UNITS,
  PLANTED_CASES,
  SOURCE_DECIMALS,
  generateTwoSource,
  parseTwoSourceArgs,
  type PlantedLabel,
  renderTwoSource,
  runTwoSource,
} from "./two-source";

/** The study's default run: seed 508, ten synthetic people, thirty days. */
const OPTIONS = {
  seed: 508,
  people: 10,
  days: 30,
  endDay: "2026-10-01",
  shares: DEFAULT_CASE_SHARES,
} as const;
const files = renderTwoSource(generateTwoSource(OPTIONS, judgeByEvidence));

type PersonFile = Readonly<{
  testData: boolean;
  personId: string;
  oura: OuraSummary;
  whoop: WhoopSummary;
  googleHealth: GoogleHealthSummary;
}>;
type PlantedFile = Readonly<{ testData: boolean; planted: readonly PlantedLabel[] }>;

const parsed = <T>(path: string): T => JSON.parse(files.get(path) ?? "null") as T;

const people = [...files.keys()]
  .filter((path) => path.startsWith("people/"))
  .map((path) => ({
    person: parsed<PersonFile>(path),
    planted: parsed<PlantedFile>(path.replace("people/", "planted/")),
  }));

/** What a decision says, in the planted label's terms. */
const outcome = (decision: SourceDecision) => ({
  kind: decision.kind,
  reason: decision.kind === "held_back" ? decision.reason : null,
  used:
    decision.kind === "evidence" || decision.kind === "only_source"
      ? decision.chosen.source
      : null,
});

const sourcesOf = (decision: SourceDecision) =>
  (decision.kind === "held_back"
    ? decision.readings
    : decision.kind === "only_source"
      ? [decision.chosen]
      : [decision.chosen, ...decision.others]
  ).map((reading) => reading.source);

describe("two-source synthetic wearables (#508)", () => {
  test("seed 508 plants exact counts of each case, with the shares used", () => {
    const manifest = parsed<{ shares: unknown; counts: unknown }>("manifest.json");
    expect(manifest.shares).toEqual(DEFAULT_CASE_SHARES);
    expect(manifest.counts).toEqual({
      byCase: {
        agree: 376,
        evidence: 182,
        no_evidence: 113,
        evidence_tie: 65,
        no_dependable_source: 0,
        units_differ: 176,
        no_day: 40,
        only_source: 248,
      },
      byGroup: {
        agree: 376,
        disagree_with_winner: 182,
        no_decision: 394,
        one_source_missing: 248,
      },
      byMeasure: {
        "heart-rate-variability": {
          agree: 73,
          evidence: 73,
          no_evidence: 48,
          units_differ: 48,
          no_day: 10,
          only_source: 48,
        },
        "resting-heart-rate": {
          agree: 97,
          no_evidence: 65,
          units_differ: 64,
          no_day: 10,
          only_source: 64,
        },
        "oxygen-saturation": {
          agree: 97,
          evidence_tie: 65,
          units_differ: 64,
          no_day: 10,
          only_source: 64,
        },
        "step-count": { agree: 109, evidence: 109, no_day: 10, only_source: 72 },
      },
    });
    const labels = people.flatMap(({ planted }) => planted.planted);
    expect(labels).toHaveLength(OPTIONS.people * OPTIONS.days * 4);
  });

  test("the rules resolver on main reproduces every planted label exactly", () => {
    let checked = 0;
    for (const { person, planted } of people) {
      const { decisions } = resolveWearableSources(
        {
          oura: person.oura,
          whoop: person.whoop,
          googleHealth: person.googleHealth,
          vitronic: null,
        },
        judgeByEvidence,
      );
      const decided = new Map(
        decisions.map((decision) => [`${decision.measure}|${decision.day}`, decision]),
      );
      expect(decided.size).toBe(planted.planted.length);
      for (const label of planted.planted) {
        const decision = decided.get(`${label.measure}|${label.day}`);
        if (decision === undefined) throw new Error(`No decision for ${label.day}`);
        expect([label.case, outcome(decision)]).toEqual([label.case, label.expected]);
        expect(sourcesOf(decision).toSorted()).toEqual([...label.sources].toSorted());
        checked += 1;
      }
    }
    expect(checked).toBe(1200);
  });

  test("the same seed writes byte-identical files; another seed moves them", () => {
    const again = renderTwoSource(generateTwoSource(OPTIONS, judgeByEvidence));
    expect([...again.entries()]).toEqual([...files.entries()]);
    const other = renderTwoSource(
      generateTwoSource({ ...OPTIONS, seed: 509 }, judgeByEvidence),
    );
    expect(other.get("people/test-509-person-01.json")).not.toBe(
      files.get("people/test-508-person-01.json"),
    );
  });

  test("every file is tagged as test data from the current rules", () => {
    for (const [path, text] of files) {
      const value = JSON.parse(text) as { testData?: unknown; rulesVersion?: unknown };
      expect([path, value.testData, value.rulesVersion]).toEqual([
        path,
        true,
        SOURCE_RULES_VERSION,
      ]);
    }
    for (const { person } of people) {
      expect(person.personId).toStartWith("test-508-");
      expect(person.oura.narrative).toContain("Synthetic test data");
    }
  });

  test("a planted unit is one the rules do not accept for the measure", () => {
    for (const [measure, foreign] of Object.entries(FOREIGN_UNITS)) {
      expect(
        SOURCE_UNITS[measure as keyof typeof SOURCE_UNITS].includes(
          foreign.unit.toLowerCase(),
        ),
      ).toBe(false);
    }
  });

  test("winners and abstentions come from the judge, pair by pair", () => {
    const plans = casePlans(judgeByEvidence);
    for (const [measure, plan] of Object.entries(plans)) {
      for (const pair of plan.get("evidence") ?? []) {
        expect(judgeByEvidence(pair, measure as keyof typeof plans).kind).toBe(
          "selected",
        );
      }
    }
    expect(plans["oxygen-saturation"].get("evidence_tie")).toEqual([
      ["whoop", "google_health"],
    ]);
  });

  test("it writes files only, never to a database", () => {
    const source = readFileSync(join(import.meta.dir, "two-source.ts"), "utf8");
    expect(source).not.toMatch(/prisma|infrastructure\/database|warehouse/i);
  });

  test("the CLI writes the rendered files under the output folder", async () => {
    const written = new Map<string, string>();
    const out: string[] = [];
    const code = await runTwoSource(
      ["--people", "2", "--days", "3", "--out", "out"],
      { stdout: { write: (chunk) => out.push(chunk) }, stderr: { write: () => {} } },
      async (path, text) => {
        written.set(path, text);
      },
    );
    expect(code).toBe(0);
    expect([...written.keys()].toSorted()).toEqual([
      "out/manifest.json",
      "out/people/test-508-person-01.json",
      "out/people/test-508-person-02.json",
      "out/planted/test-508-person-01.json",
      "out/planted/test-508-person-02.json",
    ]);
    expect(out.join("")).toContain("seed 508");
  });

  test("bad flags are refused in plain words", () => {
    expect(parseTwoSourceArgs(["--seed", "x"])).toBe("--seed must be a whole number.");
    expect(parseTwoSourceArgs(["--end", "1 Oct"])).toBe(
      "--end must be a date like 2026-10-01.",
    );
    expect(parseTwoSourceArgs([])).toMatchObject({
      seed: 508,
      output: ".synthetic-wearables/two-source-seed508",
    });
  });

  test("readings just inside a tolerance agree and just outside do not (±0.1)", () => {
    const highs: Readonly<Record<SourceMeasure, readonly number[]>> = {
      "heart-rate-variability": [21.3, 50, 72.5, 118.4],
      "resting-heart-rate": [44, 61, 87],
      "oxygen-saturation": [93.2, 97, 100],
      "step-count": [1200, 4000, 8123, 21_000],
    };
    const round = (value: number) => Math.round(value * 1000) / 1000;
    for (const measure of SOURCE_MEASURES) {
      for (const high of highs[measure]) {
        const bound = appliedTolerance(SOURCE_TOLERANCE[measure], high);
        for (const [offset, kind] of [
          [-0.1, "agree"],
          [0.1, "held_back"],
        ] as const) {
          const decision = decideOccasion(
            { measure, day: "2026-10-01" },
            [
              { key: "whoop.a", source: "whoop", value: high, unit: null, shown: "" },
              {
                key: "google.b",
                source: "google_health",
                value: round(high - bound - offset),
                unit: null,
                shown: "",
              },
            ],
            () => ({ kind: "abstained", reason: "no_evidence", grades: {} }),
          );
          expect([measure, high, offset, decision.kind]).toEqual([
            measure,
            high,
            offset,
            kind,
          ]);
        }
      }
    }
  });

  test("planted pairs sit a tenth or more from the bound, and some sit right at that edge", () => {
    let insideEdge = 0;
    let outsideEdge = 0;
    for (const { person, planted } of people) {
      const values = new Map(
        [person.oura, person.whoop, person.googleHealth].flatMap((summary) =>
          summary.metrics.map((metric) => [metric.key, Number(metric.value)] as const),
        ),
      );
      for (const label of planted.planted) {
        if (!["agree", "evidence", "no_evidence", "evidence_tie"].includes(label.case)) {
          continue;
        }
        const pair = label.keys.map((key) => values.get(key) ?? Number.NaN);
        const high = Math.max(...pair);
        const gap =
          high -
          Math.min(...pair) -
          appliedTolerance(SOURCE_TOLERANCE[label.measure], high);
        if (pair.every(Number.isInteger)) continue;
        expect(Math.abs(gap)).toBeGreaterThanOrEqual(0.1 - 1e-9);
        if (gap < 0 && gap > -0.2) insideEdge += 1;
        if (gap > 0 && gap < 0.2) outsideEdge += 1;
      }
    }
    expect(insideEdge).toBeGreaterThan(0);
    expect(outsideEdge).toBeGreaterThan(0);
  });

  test("values carry each source's own precision", () => {
    for (const { person } of people) {
      for (const [source, summary] of [
        ["oura", person.oura],
        ["whoop", person.whoop],
        ["google_health", person.googleHealth],
      ] as const) {
        for (const metric of summary.metrics) {
          const measure = Object.entries(COMPARABLE_STEMS).find(([stem]) =>
            metric.key.startsWith(`${stem}.`),
          )?.[1];
          if (measure === undefined || metric.unit === FOREIGN_UNITS[measure]?.unit)
            continue;
          const tenths = Number(metric.value) * 10;
          expect([metric.key, Math.abs(tenths - Math.round(tenths)) < 1e-9]).toEqual([
            metric.key,
            true,
          ]);
          if (SOURCE_DECIMALS[source][measure] === 0) {
            expect([metric.key, Number.isInteger(metric.value)]).toEqual([
              metric.key,
              true,
            ]);
          }
        }
      }
    }
    const whoopDecimals = people
      .flatMap(({ person }) => person.whoop.metrics)
      .filter((metric) => /whoop\.recovery\.(hrv|spo2)/.test(metric.key))
      .filter((metric) => !Number.isInteger(metric.value));
    expect(whoopDecimals.length).toBeGreaterThan(0);
  });

  test("the dateless case is held back as no_day, once per person and measure", () => {
    const dateless = people.flatMap(({ planted }) =>
      planted.planted.filter((label) => label.case === "no_day"),
    );
    expect(dateless.every((label) => label.day === null)).toBe(true);
    expect(
      dateless.every((label) => label.keys.every((key) => key.endsWith(".unknown"))),
    ).toBe(true);
    const seen = new Set(dateless.map((label) => `${label.personId}|${label.measure}`));
    expect(seen.size).toBe(dateless.length);
  });

  test("shares are a config: a share of 0 drops a case, no_day stays capped per person", () => {
    const plans = casePlans(judgeByEvidence);
    const withoutDateless = { ...DEFAULT_CASE_SHARES, no_day: 0 };
    expect(caseQuotas(plans["step-count"], withoutDateless, 10, 30)).toEqual(
      new Map([
        ["agree", 113],
        ["evidence", 112],
        ["only_source", 75],
      ]),
    );
    const heavy = { ...DEFAULT_CASE_SHARES, no_day: 100 };
    expect(caseQuotas(plans["step-count"], heavy, 10, 30).get("no_day")).toBe(10);
    const output = generateTwoSource(
      { ...OPTIONS, shares: withoutDateless },
      judgeByEvidence,
    );
    expect(output.counts.byCase.no_day).toBe(0);
    expect(parseTwoSourceArgs(["--shares", "agree=2,no_day=0"])).toMatchObject({
      shares: { ...DEFAULT_CASE_SHARES, agree: 2, no_day: 0 },
    });
    expect(parseTwoSourceArgs(["--shares", "agreed=2"])).toStartWith("--shares takes");
    expect(
      parseTwoSourceArgs([
        "--shares",
        PLANTED_CASES.map((kind) => `${kind}=0`).join(","),
      ]),
    ).toStartWith("--shares leaves no case");
  });

  test("the doc's table of possible cases matches what the judge and rules allow", () => {
    const doc = readFileSync(
      join(import.meta.dir, "../../docs/evaluation/synthetic-wearables.md"),
      "utf8",
    );
    const plans = casePlans(judgeByEvidence);
    for (const measure of SOURCE_MEASURES) {
      const row = doc.split("\n").find((line) => line.startsWith(`| \`${measure}\``));
      const cells = (row ?? "")
        .split("|")
        .slice(2, -1)
        .map((cell) => cell.trim());
      expect([measure, cells]).toEqual([
        measure,
        PLANTED_CASES.map((kind) => (plans[measure].has(kind) ? "yes" : "no")),
      ]);
    }
  });
});

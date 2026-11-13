import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { judgeByEvidence } from "@/infrastructure/open-twin-adapters/aggregate";
import type { GoogleHealthSummary } from "@/infrastructure/google-health-types";
import type { OuraSummary } from "@/infrastructure/oura-types";
import { resolveWearableSources } from "@/infrastructure/wearable-source-resolve";
import {
  SOURCE_RULES_VERSION,
  SOURCE_UNITS,
  type SourceDecision,
} from "@/infrastructure/wearable-source-rules";
import type { WhoopSummary } from "@/infrastructure/whoop-types";

import {
  casePlans,
  FOREIGN_UNITS,
  generateTwoSource,
  parseTwoSourceArgs,
  type PlantedLabel,
  renderTwoSource,
  runTwoSource,
} from "./two-source";

/** The study's default run: seed 508, ten synthetic people, thirty days. */
const OPTIONS = { seed: 508, people: 10, days: 30, endDay: "2026-10-01" } as const;
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
  test("seed 508 plants exact counts of each case", () => {
    const manifest = parsed<{ counts: unknown }>("manifest.json");
    expect(manifest.counts).toEqual({
      byCase: {
        agree: 310,
        evidence: 160,
        no_evidence: 135,
        evidence_tie: 75,
        no_dependable_source: 0,
        units_differ: 210,
        only_source: 310,
      },
      byGroup: {
        agree: 310,
        disagree_with_winner: 160,
        no_decision: 420,
        one_source_missing: 310,
      },
      byMeasure: {
        "heart-rate-variability": {
          agree: 60,
          evidence: 60,
          no_evidence: 60,
          units_differ: 60,
          only_source: 60,
        },
        "resting-heart-rate": {
          agree: 75,
          no_evidence: 75,
          units_differ: 75,
          only_source: 75,
        },
        "oxygen-saturation": {
          agree: 75,
          evidence_tie: 75,
          units_differ: 75,
          only_source: 75,
        },
        "step-count": { agree: 100, evidence: 100, only_source: 100 },
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
});

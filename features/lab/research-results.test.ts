import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { markdownTable, parseBracketInterval } from "./research-markdown";
import {
  afDatabasesCard,
  afResolutionCard,
  disclosureCard,
  groundingCard,
  plantedRulesCard,
  RESEARCH_SOURCES,
  type ResearchCard,
  type ResearchFiles,
  type ResearchSource,
  researchCards,
  rrGridCard,
  ruleChangeCard,
  shuffledNullCard,
  specialistsCard,
  withinPersonCard,
} from "./research-results";

/** Fixtures are excerpts cut from the committed files in docs/research, unchanged. */
const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, "research-fixtures", name), "utf8");

const estimatesOf = (card: ResearchCard | null) => {
  if (card === null || card.figure.kind !== "estimates") throw new Error("no estimates");
  return card.figure;
};

const rows = (card: ResearchCard | null) =>
  estimatesOf(card).estimates.map((e) => [e.label, e.estimate, e.low, e.high]);

describe("markdownTable", () => {
  const md = [
    "## First",
    "| A | B |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "## Second",
    "| A | B |",
    "| --- | --- |",
    "| 3 | 4 |",
    "| 5 | 6 |",
    "text",
  ].join("\n");

  test("finds the first table with that header, or the first after a heading", () => {
    expect(markdownTable(md, ["A", "B"])).toEqual([["1", "2"]]);
    expect(markdownTable(md, ["A", "B"], "## Second")).toEqual([
      ["3", "4"],
      ["5", "6"],
    ]);
  });

  test("a different header, or a missing heading, finds nothing", () => {
    expect(markdownTable(md, ["A", "C"])).toBeNull();
    expect(markdownTable(md, ["A"])).toBeNull();
    expect(markdownTable(md, ["A", "B"], "## Third")).toBeNull();
  });
});

describe("parseBracketInterval", () => {
  test("reads a value and its interval", () => {
    expect(parseBracketInterval("0.954 [0.930, 0.974]")).toEqual({
      value: 0.954,
      low: 0.93,
      high: 0.974,
    });
    expect(parseBracketInterval("0.954 [0.929, 0.973] (3890/4078)")).toEqual({
      value: 0.954,
      low: 0.929,
      high: 0.973,
    });
  });

  test("anything else is null", () => {
    expect(parseBracketInterval("n/a")).toBeNull();
    expect(parseBracketInterval("0.954")).toBeNull();
  });
});

describe("P1 grounding", () => {
  test("arms and the held-out set from the page's tables, as shares with Wilson intervals", () => {
    const card = groundingCard(fixture("eval-runs.md"));
    expect(rows(card)).toEqual([
      ["Audited tools", (36 / 101) * 100, 27, 45],
      ["Key's own rows in the prompt", (52 / 85) * 100, 51, 71],
      ["Whole record in the prompt", (6 / 78) * 100, 4, 16],
      ["Code over the record", (6 / 70) * 100, 4, 17],
      ["Audited tools, held-out questions", (18 / 30) * 100, 42, 75],
    ]);
    expect(estimatesOf(card).estimates[0]!.readout).toBe(
      "Audited tools · 36/101 correct, Wilson 95 % 27–45 %",
    );
    expect(estimatesOf(card).domain).toEqual([0, 100]);
    expect(card!.source).toBe("docs/research/eval-runs-2026-10.md");
    expect(card!.runDate).toBeNull();
  });

  test("a page without the arms table gives no figure", () => {
    expect(groundingCard("# Evaluation runs\n\nNothing yet.")).toBeNull();
    expect(groundingCard(undefined)).toBeNull();
  });

  test("specialists leave out the rescored runs and keep the summary's date", () => {
    const card = specialistsCard(fixture("eval-specialists.json"));
    expect(rows(card)).toEqual([
      ["rhythm on s7, qwen3:4b", (15 / 31) * 100, 32, 65],
      ["rhythm on s7, qwen3:8b", (10 / 20) * 100, 30, 70],
    ]);
    expect(card!.runDate).toBe("2026-11-02");
  });
});

describe("P2 in-silico arrhythmia", () => {
  test("sensitivity and specificity per database and noise level from the side-by-side table", () => {
    const card = afDatabasesCard(fixture("rhythm-bench.md"));
    if (card === null || card.figure.kind !== "pairs") throw new Error("no pairs");
    expect(
      card.figure.groups.map((g) => [
        g.label,
        g.estimates.map((e) => [e.label, e.estimate, e.low, e.high]),
      ]),
    ).toEqual([
      [
        "AFDB, noise none",
        [
          ["Sensitivity", 0.954, 0.93, 0.974],
          ["Specificity", 0.796, 0.699, 0.879],
        ],
      ],
      [
        "LTAFDB, noise none",
        [
          ["Sensitivity", 0.947, 0.919, 0.968],
          ["Specificity", 0.841, 0.769, 0.898],
        ],
      ],
      [
        "AFDB, noise light",
        [
          ["Sensitivity", 0.98, 0.969, 0.99],
          ["Specificity", 0.289, 0.177, 0.418],
        ],
      ],
      [
        "LTAFDB, noise light",
        [
          ["Sensitivity", 0.989, 0.981, 0.994],
          ["Specificity", 0.302, 0.249, 0.356],
        ],
      ],
      [
        "AFDB, noise heavy",
        [
          ["Sensitivity", 0.986, 0.98, 0.991],
          ["Specificity", 0.008, 0.004, 0.012],
        ],
      ],
      [
        "LTAFDB, noise heavy",
        [
          ["Sensitivity", 0.992, 0.989, 0.994],
          ["Specificity", 0.028, 0.018, 0.04],
        ],
      ],
    ]);
    expect(card.figure.groups[0]!.estimates[1].readout).toBe(
      "AFDB, noise none · specificity 0.796 (0.699–0.879)",
    );
  });

  test("beats to daily values at 2 % burden, against chance", () => {
    const card = afResolutionCard(fixture("af-resolution.json"));
    expect(rows(card)).toEqual([
      ["Beats: 128-beat windows flagged", 1, 1, 1],
      ["Night RMSSD", 0.50875, 0.40873046875, 0.60147265625],
    ]);
    expect(estimatesOf(card).reference).toEqual({ value: 0.5, label: "0.5 = chance" });
    expect(estimatesOf(card).estimates[1]!.readout).toBe(
      "Night RMSSD · AUROC 0.509 (0.409–0.601)",
    );
    expect(card!.runDate).toBe("2026-10-31");
  });

  test("mean TPR, real and simulated on a grid", () => {
    const card = rrGridCard(fixture("rr-grid.json"));
    expect(rows(card)).toEqual([
      ["AFDB, 23 records", 0.6291998537061119, 0.6186825201429763, 0.6404113411440401],
      [
        "Simulated independent, 7.8125 ms grid",
        0.6409128289473685,
        0.6363196472515418,
        0.6450187567349138,
      ],
    ]);
    expect(card!.runDate).toBe("2026-11-02");
  });
});

describe("P3 heart–brain", () => {
  test("within-person ratios by window, against 1", () => {
    const card = withinPersonCard(fixture("heart-brain-timing.json"));
    expect(rows(card)).toEqual([
      ["Any time after onset", 3.093, 2.067, 4.627],
      ["0–2 years after", 3.807, 2.345, 6.183],
    ]);
    expect(estimatesOf(card).estimates[0]!.readout).toBe(
      "Any time after onset · 3.09 (2.07–4.63)",
    );
    expect(estimatesOf(card).reference?.value).toBe(1);
    expect(card!.sentence).toContain("8,144 synthetic people");
  });

  test("rule change: estimate and expected for each rule", () => {
    const card = ruleChangeCard(fixture("heart-brain-full-history.json"));
    expect(rows(card)).toEqual([
      ["Rule as shipped, estimate", 1.91, 1, 3.65],
      ["Rule as shipped, expected", 2.15, undefined, undefined],
      ["AF part doubled, estimate", 3.95, 2.17, 7.2],
      ["AF part doubled, expected", 3.93, undefined, undefined],
    ]);
  });

  test("observed against shuffled onset, and the planted rules", () => {
    const shuffled = shuffledNullCard(fixture("heart-brain.json"));
    expect(rows(shuffled)).toEqual([
      ["Observed", 2.540863417276496, 1.9504620844291192, 3.3099781619921087],
      [
        "Shuffled onset, 50 runs",
        2.3919549747233635,
        2.0443953567950386,
        2.7781390831577037,
      ],
    ]);
    expect(shuffled!.runDate).toBe("2026-10-29");
    const planted = plantedRulesCard(fixture("heart-brain.json"));
    // The anticoagulant pair has too few events and no ratio, so it is left out.
    expect(rows(planted)).toEqual([
      ["AF then stroke", 2.540863417276496, 1.9504620844291192, 3.3099781619921087],
    ]);
    expect(estimatesOf(planted).estimates[0]!.readout).toBe(
      "AF then stroke · 2.54 (1.95–3.31); linked directly by a rule",
    );
  });
});

describe("P4 disclosure", () => {
  test("record-level AUROC for the pilot and the positive control, against chance", () => {
    const card = disclosureCard(fixture("disclosure.json"));
    expect(rows(card)).toEqual([
      ["Pilot 1 checkpoint, loss", 0.499712, 0.4673252656089117, 0.535616425700207],
      ["Pilot 1 checkpoint, reference", 0.517064, 0.48318420416232993, 0.551264427576509],
      ["Pilot 1 served, loss", 0.511956, 0.4762088366850923, 0.5459567889380094],
      ["Pilot 1 served, reference", 0.518512, 0.4842210010673024, 0.552308308699873],
      ["Positive control, loss", 0.7075, 0.5905620252274788, 0.8057977379810305],
      [
        "Positive control, pilot 1 as reference",
        0.7825,
        0.6760225199675001,
        0.8697751434759965,
      ],
    ]);
    expect(estimatesOf(card).estimates[4]!.readout).toBe(
      "Positive control, loss · AUROC 0.708 (0.591–0.806), 40 members and 40 non-members",
    );
  });

  test("a summary of another shape gives no figure", () => {
    expect(disclosureCard('{"attacks":{}}')).toBeNull();
    expect(disclosureCard("not json")).toBeNull();
  });
});

describe("researchCards", () => {
  test("orders the figures by study and names the sources that gave none", () => {
    const read = researchCards({
      disclosure: fixture("disclosure.json"),
      evalRuns: fixture("eval-runs.md"),
    });
    expect(read.cards.map((c) => c.id)).toEqual([
      "grounding-arms",
      "disclosure-membership",
    ]);
    expect(read.unread).toEqual([
      RESEARCH_SOURCES.specialists,
      RESEARCH_SOURCES.rhythmBench,
      RESEARCH_SOURCES.afResolution,
      RESEARCH_SOURCES.rrGrid,
      RESEARCH_SOURCES.timing,
      RESEARCH_SOURCES.fullHistory,
      RESEARCH_SOURCES.heartBrain,
    ]);
  });

  test("the committed files give every figure, with the headline numbers", () => {
    const root = join(import.meta.dir, "..", "..");
    const files: ResearchFiles = Object.fromEntries(
      (Object.entries(RESEARCH_SOURCES) as [ResearchSource, string][]).map(
        ([source, path]) => [source, readFileSync(join(root, path), "utf8")],
      ),
    );
    const read = researchCards(files);
    expect(read.unread).toEqual([]);
    expect(read.cards.map((c) => c.id)).toEqual([
      "grounding-arms",
      "grounding-specialists",
      "arrhythmia-databases",
      "arrhythmia-resolution",
      "arrhythmia-rr-grid",
      "heart-brain-within",
      "heart-brain-rule-change",
      "heart-brain-shuffled",
      "heart-brain-planted",
      "disclosure-membership",
    ]);
    const byId = new Map(read.cards.map((c) => [c.id, c]));
    expect(estimatesOf(byId.get("heart-brain-within")!).estimates[0]!.readout).toBe(
      "Any time after onset · 3.09 (2.07–4.63)",
    );
    expect(rows(byId.get("heart-brain-rule-change")!).map((r) => r[1])).toEqual([
      1.91, 2.15, 3.95, 3.93,
    ]);
    const pairs = byId.get("arrhythmia-databases")!.figure;
    if (pairs.kind !== "pairs") throw new Error("no pairs");
    expect(
      pairs.groups.slice(0, 2).map((g) => g.estimates.map((e) => e.estimate)),
    ).toEqual([
      [0.954, 0.796],
      [0.947, 0.841],
    ]);
    expect(rows(byId.get("grounding-specialists")!).map((r) => r[0])).toEqual([
      "rhythm on s7, qwen3:4b",
      "rhythm on s7, qwen3:8b",
      "rhythm on s7b, qwen3:4b",
      "rhythm on s7b, qwen3:8b",
      "rhythm on s7h, qwen3:4b",
      "rhythm on s7h, qwen3:8b",
      "brain on s7, qwen3:4b",
      "brain on s7, qwen3:8b",
      "gp on v1, qwen3:4b",
      "gp on v1, qwen3:8b",
    ]);
  });
});

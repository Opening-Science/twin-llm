import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { markdownTable, parseBracketInterval } from "./research-markdown";
import {
  readAfResolution,
  readArms,
  readDisclosure,
  readHeartBrain,
  readNoiseTable,
  readRrGrid,
  readRuleChange,
  readSpecialists,
  readWithinPerson,
} from "./research-read";
import {
  afDatabasesCard,
  afResolutionCard,
  disclosureCard,
  groundingCard,
  plantedRulesCard,
  RESEARCH_SOURCES,
  type ResearchCard,
  type ResearchFigureData,
  type ResearchFiles,
  type ResearchSource,
  researchCards,
  rrGridCard,
  ruleChangeCard,
  shuffledNullCard,
  specialistCards,
  withinPersonCard,
} from "./research-results";

/** Fixtures are excerpts cut from the committed files in docs/research, unchanged. */
const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, "research-fixtures", name), "utf8");

const estimatesOf = (figure: ResearchFigureData | undefined) => {
  if (figure === undefined || figure.kind !== "estimates")
    throw new Error("no estimates");
  return figure;
};

const rows = (figure: ResearchFigureData | undefined) =>
  estimatesOf(figure).estimates.map((e) => [e.label, e.estimate, e.low, e.high]);

const labels = (figure: ResearchFigureData | undefined) =>
  estimatesOf(figure).estimates.map((e) => e.label);

const card = (c: ResearchCard | null | undefined): ResearchCard => {
  if (c == null) throw new Error("no card");
  return c;
};

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
  test("arms and the held-out set as shares with Wilson intervals, and a plain headline", () => {
    const c = card(groundingCard(readArms(fixture("eval-runs.md"))));
    expect(rows(c.figure)).toEqual([
      ["Audited tools", (36 / 101) * 100, 27, 45],
      ["Only the asked rows pasted in", (52 / 85) * 100, 51, 71],
      ["Whole record pasted in", (6 / 78) * 100, 4, 16],
      ["Model writes code", (6 / 70) * 100, 4, 17],
      ["Audited tools, held-out questions (v1h)", (18 / 30) * 100, 42, 75],
    ]);
    expect(c.headline).toBe(
      "With audited tools, qwen3:4b gave the right value in 36 of 101 (36\u00a0%) scored answers; with the whole record pasted into the prompt, in 6 of 78 (8\u00a0%).",
    );
    expect(c.axis).toBe("% of scored answers right");
    expect(estimatesOf(c.figure).estimates[0]!.readout).toBe(
      "Audited tools · 36/101 right (36\u00a0%), Wilson 95 % interval 27–45 %",
    );
    expect(c.source).toBe("docs/research/eval-runs-2026-10.md");
    expect(c.more).toBeNull();
  });

  test("a page without the arms table gives no figure", () => {
    expect(readArms("# Evaluation runs\n\nNothing yet.")).toBeNull();
    expect(groundingCard(readArms(undefined))).toBeNull();
  });

  test("specialists: one figure grouped by model size, rescored runs left out", () => {
    const cards = specialistCards(readSpecialists(fixture("eval-specialists.json")));
    expect(cards.map((c) => c.id)).toEqual(["grounding-specialists"]);
    const c = cards[0]!;
    expect(rows(c.figure)).toEqual([
      ["Heart rhythm, rhythm set (s7), 4b", (15 / 31) * 100, 32, 65],
      ["Heart rhythm, rhythm set (s7), 8b", (10 / 20) * 100, 30, 70],
    ]);
    expect(estimatesOf(c.figure).estimates[1]!.readout).toBe(
      "Heart rhythm agent, rhythm set (s7), qwen3:8b · 10/20 right (50 %), Wilson 95 % interval 30–70 %",
    );
    expect(estimatesOf(c.figure).estimates.map((e) => e.series)).toEqual([
      "qwen3:4b",
      "qwen3:8b",
    ]);
    expect(c.runDate).toBe("2026-11-02");
    expect(c.headline).toBe(
      "The share of right values ran from 15 of 31 (48\u00a0%) for the Heart rhythm agent, rhythm set (s7), on qwen3:4b, to 10 of 20 (50\u00a0%) for the Heart rhythm agent, rhythm set (s7), on qwen3:8b.",
    );
  });

  test("specialists: a run with no scored answers never ranks lowest or highest, across models", () => {
    const cell = (passes: number, n: number) => ({ passes, n, lowPct: 0, highPct: 100 });
    const [c] = specialistCards({
      date: null,
      runs: [
        { agent: "rhythm", set: "s7", model: "qwen3:4b", cell: cell(0, 0) },
        { agent: "brain", set: "s7", model: "qwen3:4b", cell: cell(5, 10) },
        { agent: "gp", set: "v1", model: "qwen3:4b", cell: cell(9, 10) },
        { agent: "rhythm", set: "s7b", model: "qwen3:4b", cell: cell(0, 0) },
        { agent: "rhythm", set: "s7", model: "qwen3:8b", cell: cell(0, 0) },
      ],
    });
    expect(c!.headline).toBe(
      "The share of right values ran from 5 of 10 (50\u00a0%) for the Brain agent, rhythm set (s7), on qwen3:4b, to 9 of 10 (90\u00a0%) for the General agent, main set (v1), on qwen3:4b.",
    );
    expect(c!.headline).not.toContain("NaN");
  });

  test("specialists: one scored run names its model; none gives no figures", () => {
    const cell = (passes: number, n: number) => ({ passes, n, lowPct: 0, highPct: 100 });
    const one = specialistCards({
      date: null,
      runs: [
        { agent: "brain", set: "s7", model: "qwen3:8b", cell: cell(3, 12) },
        { agent: "gp", set: "v1", model: "qwen3:4b", cell: cell(0, 0) },
      ],
    });
    expect(one[0]!.headline).toBe(
      "On qwen3:8b, the Brain agent, rhythm set (s7) gave the right value in 3 of 12 (25\u00a0%) scored answers.",
    );
    const none = specialistCards({
      date: null,
      runs: [{ agent: "gp", set: "v1", model: "qwen3:4b", cell: cell(0, 0) }],
    });
    expect(none[0]!.headline).toBe("No answers were scored.");
  });
});

describe("P2 in-silico arrhythmia", () => {
  test("no-noise pairs first, every noise level behind Show all", () => {
    const c = card(afDatabasesCard(readNoiseTable(fixture("rhythm-bench.md"))));
    const groups = (f: ResearchFigureData | undefined) => {
      if (f === undefined || f.kind !== "pairs") throw new Error("no pairs");
      return f.groups.map((g) => [
        g.label,
        g.estimates.map((e) => [e.estimate, e.low, e.high]),
      ]);
    };
    expect(groups(c.figure)).toEqual([
      [
        "AFDB, no added noise",
        [
          [0.954, 0.93, 0.974],
          [0.796, 0.699, 0.879],
        ],
      ],
      [
        "LTAFDB, no added noise",
        [
          [0.947, 0.919, 0.968],
          [0.841, 0.769, 0.898],
        ],
      ],
    ]);
    expect(groups(c.more?.figure).map((g) => g[0])).toEqual([
      "AFDB, no added noise",
      "LTAFDB, no added noise",
      "AFDB, light noise",
      "LTAFDB, light noise",
      "AFDB, heavy noise",
      "LTAFDB, heavy noise",
    ]);
    // Grouped by database: both rows of a database share its series.
    const series = (f: ResearchFigureData | undefined) => {
      if (f === undefined || f.kind !== "pairs") throw new Error("no pairs");
      return f.groups.map((g) => g.estimates.map((e) => e.series));
    };
    expect(series(c.figure)).toEqual([
      ["AFDB", "AFDB"],
      ["LTAFDB", "LTAFDB"],
    ]);
    expect(c.headline).toBe(
      "With no added noise, the flag found AF windows with sensitivity 0.954 on AFDB and 0.947 on LTAFDB, at specificity 0.796 and 0.841; with light noise, specificity was 0.289 and 0.302.",
    );
    expect(c.axis).toBe("sensitivity and specificity (0–1)");
  });

  test("beats to daily values at 2 % burden, against chance", () => {
    const c = card(afResolutionCard(readAfResolution(fixture("af-resolution.json"))));
    expect(rows(c.figure)).toEqual([
      ["Beats: 128-beat windows flagged", 1, 1, 1],
      ["Night heart rate variability (RMSSD)", 0.50875, 0.40873046875, 0.60147265625],
    ]);
    expect(estimatesOf(c.figure).reference).toEqual({
      value: 0.5,
      label: "0.5 = chance",
    });
    expect(c.headline).toBe(
      "On simulated days with 2 % of the time in AF, beat windows told AF days from sinus days with AUROC 1.000; night heart rate variability, a daily wearable value, with 0.509, where 0.5 is chance.",
    );
    expect(c.runDate).toBe("2026-10-31");
    // Every row of the fixture is a main row, so there is nothing more to show.
    expect(c.more).toBeNull();
  });

  test("RR grid: the databases and the short-range runs, the rest behind Show all", () => {
    const grid = readRrGrid(fixture("rr-grid.json"));
    const c = card(rrGridCard(grid));
    // The fixture has no short-range run, so the figure shows every row.
    expect(rows(c.figure)).toEqual([
      ["AFDB, 23 records", 0.6291998537061119, 0.6186825201429763, 0.6404113411440401],
      [
        "Simulated independent, 7.8 ms grid",
        0.6409128289473685,
        0.6363196472515418,
        0.6450187567349138,
      ],
    ]);
    expect(estimatesOf(c.figure).estimates.map((e) => e.series)).toEqual([
      "AFDB",
      "Simulated",
    ]);
    // A short label fits a phone's card; the readout keeps the long form.
    expect(estimatesOf(c.figure).estimates[1]!.readout).toStartWith(
      "Simulated, independent intervals, 7.8125 ms grid · mean TPR 0.641",
    );
    expect(c.more).toBeNull();
    expect(c.runDate).toBe("2026-11-02");
  });
});

describe("P3 heart–brain", () => {
  test("within-person ratios by window, against 1", () => {
    const c = card(
      withinPersonCard(readWithinPerson(fixture("heart-brain-timing.json"))),
    );
    expect(rows(c.figure)).toEqual([
      ["Any time after onset", 3.093, 2.067, 4.627],
      ["0–2 years after", 3.807, 2.345, 6.183],
    ]);
    expect(c.headline).toBe(
      "In the same 8,144 synthetic people, the stroke rate after AF onset was 3.09 times the rate before it (95 % interval 2.07–4.63), age-adjusted.",
    );
    expect(c.axis).toBe("rate ratio (1 = no difference)");
    expect(estimatesOf(c.figure).scale).toBe("log");
  });

  test("rule change: one row per rule, its expected value as the tick", () => {
    const c = card(
      ruleChangeCard(readRuleChange(fixture("heart-brain-full-history.json"))),
    );
    expect(
      estimatesOf(c.figure).estimates.map((e) => [
        e.label,
        e.estimate,
        e.low,
        e.high,
        e.expected,
      ]),
    ).toEqual([
      ["Rule as shipped", 1.91, 1, 3.65, 2.15],
      ["AF part doubled", 3.95, 2.17, 7.2, 3.93],
    ]);
    expect(estimatesOf(c.figure).estimates[0]!.readout).toBe(
      "Rule as shipped · 1.91 (95 % interval 1.00–3.65); the generator's rules imply 2.15",
    );
    expect(estimatesOf(c.figure).scale).toBe("log");
    expect(c.headline).toBe(
      "With the stroke rule as shipped, the estimate was 1.91 where the rules imply 2.15; with the rule's AF part doubled, 3.95 where they imply 3.93.",
    );
  });

  test("observed against shuffled onset, and the planted rules", () => {
    const data = readHeartBrain(fixture("heart-brain.json"));
    const shuffled = card(shuffledNullCard(data));
    expect(shuffled.figure).toEqual({
      kind: "null",
      observed: 2.540863417276496,
      observedLabel: "Observed",
      summary: {
        mean: 2.3919549747233635,
        low: 2.0443953567950386,
        high: 2.7781390831577037,
        runs: 50,
      },
      nullLabel: "Shuffled onset, 50 runs",
    });
    // The observed ratio's own interval stays in the caption.
    expect(shuffled.caption).toContain("(2.54, 95 % interval 1.95–3.31)");
    // The null figure has no ticks, so the axis title gives its span.
    expect(shuffled.axis).toBe(
      "matched stroke rate ratio, 2.04 at the left to 2.78 at the right",
    );
    expect(shuffled.headline).toBe(
      "People with AF had 2.54 times the stroke rate of matched people without; with AF onset dates shuffled, the same ratio averaged 2.39 over 50 runs (range 2.04–2.78).",
    );
    expect(shuffled.runDate).toBe("2026-10-29");
    const planted = card(plantedRulesCard(data));
    // The anticoagulant pair has too few events and no ratio, so it is left out.
    expect(labels(planted.figure)).toEqual(["AF then stroke"]);
    expect(planted.more).toBeNull();
    expect(estimatesOf(planted.figure).scale).toBe("log");
    expect(estimatesOf(planted.figure).estimates[0]!.readout).toBe(
      "AF then stroke · 2.54 (95 % interval 1.95–3.31); linked directly by a rule",
    );
  });
});

describe("P4 disclosure", () => {
  test("pilot and control first, the served copy behind Show all", () => {
    const c = card(disclosureCard(readDisclosure(fixture("disclosure.json"))));
    expect(rows(c.figure)).toEqual([
      ["Pilot 1, loss attack", 0.499712, 0.4673252656089117, 0.535616425700207],
      ["Pilot 1, reference attack", 0.517064, 0.48318420416232993, 0.551264427576509],
      ["Positive control, loss attack", 0.7075, 0.5905620252274788, 0.8057977379810305],
      [
        "Positive control, pilot 1 as reference",
        0.7825,
        0.6760225199675001,
        0.8697751434759965,
      ],
    ]);
    expect(labels(c.more?.figure)).toEqual([
      "Pilot 1, loss attack",
      "Pilot 1, reference attack",
      "Pilot 1 as served, loss attack",
      "Pilot 1 as served, reference attack",
      "Positive control, loss attack",
      "Positive control, pilot 1 as reference",
    ]);
    // 0.7825 is a half: it rounds away from zero to 0.783 (docs/coding-standards.md).
    expect(c.headline).toBe(
      "Against the pilot 1 fine-tune the attacks scored AUROC 0.500 to 0.519; against a deliberately overfit positive control, 0.708 to 0.783. 0.5 is chance.",
    );
    expect(c.axis).toBe("AUROC (0.5 = chance)");
  });

  test("a summary of another shape gives no figure", () => {
    expect(readDisclosure('{"attacks":{}}')).toBeNull();
    expect(readDisclosure("not json")).toBeNull();
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
    expect(Object.keys(read.summaries)).toEqual(["grounding", "disclosure"]);
  });

  test("the committed files give every figure, the headline numbers and the summaries", () => {
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
    // Each agent and set pair on both models, next to each other.
    expect(labels(byId.get("grounding-specialists")?.figure)).toEqual(
      [
        "Heart rhythm, rhythm set (s7)",
        "Heart rhythm, second rhythm set (s7b)",
        "Heart rhythm, held-out rhythm set (s7h)",
        "Brain, rhythm set (s7)",
        "General, main set (v1)",
      ].flatMap((run) => [`${run}, 4b`, `${run}, 8b`]),
    );
    expect(byId.get("grounding-specialists")?.headline).toBe(
      "The share of right values ran from 16 of 109 (15\u00a0%) for the General agent, main set (v1), on qwen3:8b, to 21 of 32 (66\u00a0%) for the Heart rhythm agent, held-out rhythm set (s7h), on qwen3:4b.",
    );
    expect(
      estimatesOf(byId.get("arrhythmia-rr-grid")?.figure).estimates.map((e) => e.series),
    ).toEqual(["AFDB", "LTAFDB", "Simulated", "Simulated", "Simulated"]);
    expect(labels(byId.get("arrhythmia-rr-grid")?.figure)).toEqual([
      "AFDB, 23 records",
      "LTAFDB, 76 records",
      "Simulated, exact beat times",
      "Simulated, 4 ms grid",
      "Simulated, 7.8 ms grid",
    ]);
    expect(byId.get("arrhythmia-rr-grid")?.caption).toContain(
      "simulated recordings with short-range dependence between intervals",
    );
    expect(labels(byId.get("arrhythmia-rr-grid")?.more?.figure)).toEqual([
      "AFDB, 23 records",
      "LTAFDB, 76 records",
      "Simulated independent, exact beat times",
      "Simulated independent, 4 ms grid",
      "Simulated independent, 7.8 ms grid",
      "Simulated short-range, exact beat times",
      "Simulated short-range, 4 ms grid",
      "Simulated short-range, 7.8 ms grid",
    ]);
    expect(labels(byId.get("arrhythmia-resolution")?.figure)).toEqual([
      "Beats: 128-beat windows flagged",
      "Hours, irregular",
      "Daily heart rate",
      "Daily resting heart rate",
      "Night heart rate variability (RMSSD)",
    ]);
    expect(labels(byId.get("heart-brain-planted")?.figure)).toEqual([
      "AF then stroke",
      "AF from age 55 then stroke",
      "Diabetes then stroke",
      "Hypertension then stroke",
      "Hypertension then AF",
    ]);
    expect(byId.get("heart-brain-planted")?.headline).toBe(
      "For condition pairs the generator links by a rule, the matched ratios ran from 1.12 to 2.94; for pairs no rule links, from 0.66 to 1.13.",
    );
    expect(read.summaries).toEqual({
      grounding: {
        found:
          "With audited tools, qwen3:4b gave the right value in 36 of 101 (36\u00a0%) scored answers. Pasting the whole record into the prompt gave 6 of 78 (8\u00a0%), and letting the model write code over the record 6 of 70 (9\u00a0%). On held-out questions with tools it was 18 of 30 (60\u00a0%).",
      },
      arrhythmia: {
        found:
          "On two open ECG databases the research flag found AF windows with sensitivity 0.954 and 0.947, at specificity 0.796 and 0.841. Light simulated beat-detection noise took specificity to 0.289 and 0.302. On simulated days, beat windows separated AF days with AUROC 1.000 and night heart rate variability with 0.509.",
      },
      "heart-brain": {
        found:
          "In synthetic people the stroke rate after AF onset was 3.09 times the rate before it (95 % interval 2.07–4.63). Doubling the AF part of the generator's stroke rule moved the estimate from 1.91 to 3.95, where the rules imply 2.15 and 3.93.",
      },
      disclosure: {
        found:
          "Membership attacks on the pilot 1 fine-tune scored AUROC 0.500 to 0.519 per record, and every interval included 0.5, the value for chance. On a deliberately overfit positive control the same attacks scored 0.708 to 0.783.",
      },
    });
  });
});

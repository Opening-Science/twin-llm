import { describe, expect, test } from "bun:test";

import { lineToken } from "../../features/lab/rater-lines";

import {
  agreementRow,
  agreementRows,
  answerIdRows,
  BOOTSTRAP_RESAMPLES,
  bootstrapInterval,
  cohenKappa,
  krippendorffAlpha,
  groupBySet,
  pairsFromTable,
  ratedSetForFile,
  restrictToLines,
  strataRows,
} from "./agreement";

/**
 * Cohen's worked example: two judges, 200 cases, three categories (Cohen
 * 1968, Psychological Bulletin 70:213-220, Table 1; p_o = .70, p_c = .41,
 * unweighted kappa .492). The Fleiss, Cohen and Everitt (1969) standard
 * error on it is 0.051 with a 95 % interval of 0.392 to 0.591, as worked in
 * full in the CRAN DMAR vignette "Weighted Kappa: Cohen's 1968
 * Illustration, Worked in Full".
 */
const COHEN_TABLE = [
  [88, 10, 2],
  [14, 40, 6],
  [18, 10, 12],
];

describe("cohenKappa", () => {
  test("Cohen's three-category example", () => {
    const result = cohenKappa(pairsFromTable(COHEN_TABLE));
    expect(result?.n).toBe(200);
    expect(result?.observed).toBeCloseTo(0.7, 10);
    expect(result?.expected).toBeCloseTo(0.41, 10);
    expect(result?.kappa).toBeCloseTo(0.492, 3);
    expect(result?.se).toBeCloseTo(0.051, 3);
    expect(result?.low).toBeCloseTo(0.392, 3);
    expect(result?.high).toBeCloseTo(0.591, 3);
  });

  test("does not depend on which rater is first", () => {
    const transposed = COHEN_TABLE.map((_, j) => COHEN_TABLE.map((row) => row[j]!));
    const a = cohenKappa(pairsFromTable(COHEN_TABLE));
    const b = cohenKappa(pairsFromTable(transposed));
    expect(b?.kappa).toBeCloseTo(a?.kappa ?? Number.NaN, 12);
    expect(b?.se).toBeCloseTo(a?.se ?? Number.NaN, 12);
  });

  test("perfect agreement on two categories is 1 with no spread", () => {
    expect(
      cohenKappa([
        ["pass", "pass"],
        ["fail", "fail"],
      ]),
    ).toEqual({ n: 2, observed: 1, expected: 0.5, kappa: 1, se: 0, low: 1, high: 1 });
  });

  test("one category for both: kappa is not defined", () => {
    expect(
      cohenKappa([
        ["pass", "pass"],
        ["pass", "pass"],
      ]),
    ).toEqual({
      n: 2,
      observed: 1,
      expected: 1,
      kappa: null,
      se: null,
      low: null,
      high: null,
    });
  });

  test("one side in one category: kappa 0 and no interval", () => {
    expect(
      cohenKappa([
        ["pass", "pass"],
        ["pass", "fail"],
      ]),
    ).toEqual({
      n: 2,
      observed: 0.5,
      expected: 0.5,
      kappa: 0,
      se: null,
      low: null,
      high: null,
    });
  });

  test("no pairs: null", () => {
    expect(cohenKappa([])).toBeNull();
  });

  test("pairsFromTable expands counts row by row", () => {
    expect(
      pairsFromTable([
        [1, 0],
        [2, 1],
      ]),
    ).toEqual([
      ["0", "0"],
      ["1", "0"],
      ["1", "0"],
      ["1", "1"],
    ]);
  });
});

/**
 * Krippendorff's worked examples (Krippendorff 2011, "Computing
 * Krippendorff's Alpha-Reliability"). Example C: four observers, twelve
 * units, values 1 to 5 with gaps; alpha is .743 nominal, .815 ordinal and
 * .849 interval. Unit 12 has one value and is not pairable. Example A: two
 * observers, ten units, binary; alpha .095.
 */
const _ = null;
const EXAMPLE_C: readonly (readonly (number | null)[])[] = [
  [1, 1, _, 1],
  [2, 2, 3, 2],
  [3, 3, 3, 3],
  [3, 3, 3, 3],
  [2, 2, 2, 2],
  [1, 2, 3, 4],
  [4, 4, 4, 4],
  [1, 1, 2, 1],
  [2, 2, 2, 2],
  [_, 5, 5, 5],
  [_, _, 1, 1],
  [_, 3, _, _],
];

describe("krippendorffAlpha", () => {
  test("example C: nominal, ordinal and interval", () => {
    const nominal = krippendorffAlpha(EXAMPLE_C, "nominal");
    expect(nominal?.units).toBe(11);
    expect(nominal?.values).toBe(40);
    expect(nominal?.alpha).toBeCloseTo(0.743, 3);
    expect(krippendorffAlpha(EXAMPLE_C, "ordinal")?.alpha).toBeCloseTo(0.815, 3);
    expect(krippendorffAlpha(EXAMPLE_C, "interval")?.alpha).toBeCloseTo(0.849, 3);
  });

  test("example A: two observers, binary", () => {
    const first = [0, 1, 0, 0, 0, 0, 0, 0, 1, 0];
    const second = [1, 1, 1, 0, 0, 1, 0, 0, 0, 0];
    const units = first.map((value, i) => [value, second[i] ?? null]);
    expect(krippendorffAlpha(units, "nominal")?.alpha).toBeCloseTo(0.095, 3);
  });

  test("perfect agreement is 1; one value only is not defined; nothing pairable is null", () => {
    expect(
      krippendorffAlpha(
        [
          [1, 1],
          [5, 5],
          [3, 3],
        ],
        "ordinal",
      )?.alpha,
    ).toBe(1);
    expect(
      krippendorffAlpha(
        [
          [4, 4],
          [4, 4],
        ],
        "ordinal",
      )?.alpha,
    ).toBeNull();
    expect(krippendorffAlpha([[1, null], [null]], "nominal")).toBeNull();
  });

  test("ordinal counts a 5 against a 1 as worse than a 5 against a 4; nominal does not", () => {
    const near = [
      [5, 4],
      [1, 1],
      [3, 3],
      [5, 5],
      [2, 2],
    ] as const;
    const far = [
      [5, 1],
      [1, 1],
      [3, 3],
      [5, 5],
      [2, 2],
    ] as const;
    const ordinal = (units: typeof near | typeof far) =>
      krippendorffAlpha(units, "ordinal")?.alpha ?? Number.NaN;
    expect(ordinal(near)).toBeGreaterThan(ordinal(far));
  });

  test("two coders on pass and fail: close to Cohen's kappa for many lines", () => {
    const pairs = pairsFromTable([
      [40, 5],
      [8, 27],
    ]);
    const units = pairs.map(([a, b]) => [Number(a), Number(b)]);
    const alpha = krippendorffAlpha(units, "nominal")?.alpha ?? Number.NaN;
    const kappa = cohenKappa(pairs)?.kappa ?? Number.NaN;
    expect(Math.abs(alpha - kappa)).toBeLessThan(0.01);
  });
});

describe("bootstrapInterval", () => {
  const pairs = pairsFromTable(COHEN_TABLE);
  const kappaOf = (sample: readonly (readonly [string, string])[]) =>
    cohenKappa(sample)?.kappa ?? null;

  test("on Cohen's example it is near the large-sample interval (.392 to .591)", () => {
    const interval = bootstrapInterval(pairs, kappaOf);
    expect(interval?.resamples).toBe(BOOTSTRAP_RESAMPLES);
    expect(interval?.used).toBe(BOOTSTRAP_RESAMPLES);
    expect(interval?.low).toBeGreaterThan(0.36);
    expect(interval?.low).toBeLessThan(0.42);
    expect(interval?.high).toBeGreaterThan(0.56);
    expect(interval?.high).toBeLessThan(0.62);
  });

  test("the same seed gives the same interval; another seed another", () => {
    const a = bootstrapInterval(pairs, kappaOf, 500, 1);
    expect(bootstrapInterval(pairs, kappaOf, 500, 1)).toEqual(a);
    expect(bootstrapInterval(pairs, kappaOf, 500, 2)).not.toEqual(a);
  });

  test("resamples where the statistic is not defined are dropped and counted", () => {
    const lopsided: [string, string][] = [
      ...Array.from({ length: 9 }, (): [string, string] => ["pass", "pass"]),
      ["fail", "fail"],
    ];
    const interval = bootstrapInterval(lopsided, kappaOf, 1000);
    expect(interval?.used).toBeLessThan(1000);
    expect(interval?.used).toBeGreaterThan(0);
    expect(interval?.high).toBe(1);
  });

  test("no units, or never defined: null", () => {
    expect(bootstrapInterval([], kappaOf)).toBeNull();
    expect(
      bootstrapInterval(
        [
          ["pass", "pass"],
          ["pass", "pass"],
        ],
        kappaOf,
        100,
      ),
    ).toBeNull();
  });
});

describe("agreementRow", () => {
  test("kappa, alpha and both bootstrap intervals for one comparison", () => {
    const pairs: [string, string][] = [
      ["5", "5"],
      ["4", "5"],
      ["1", "2"],
      ["3", "3"],
      ["2", "1"],
      ["5", "4"],
      ["4", "4"],
      ["1", "1"],
    ];
    const row = agreementRow("a vs b (five levels)", pairs, "ordinal");
    expect(row.result?.n).toBe(8);
    expect(row.metric).toBe("ordinal");
    expect(row.alpha?.alpha).toBeGreaterThan(0.8);
    expect(row.alphaBootstrap?.low).toBeLessThanOrEqual(row.alpha?.alpha ?? Number.NaN);
    expect(row.alphaBootstrap?.high).toBeLessThanOrEqual(1);
    expect(row.kappaBootstrap?.high).toBeLessThanOrEqual(1);
  });
});

describe("agreementRows", () => {
  const run = (
    runId: string,
    scorer: Record<string, "pass" | "fail">,
    raters: Record<string, Record<string, number>>,
  ) => ({
    runId,
    scorer: new Map(Object.entries(scorer)),
    raters: new Map(
      Object.entries(raters).map(([name, levels]) => [
        name,
        new Map(Object.entries(levels)),
      ]),
    ),
  });

  test("raters against the scorer and against each other, pooled over runs", () => {
    const rows = agreementRows([
      run(
        "r1",
        { "Q-1#1": "pass", "Q-2#1": "fail" },
        { "rater-b": { "Q-1#1": 5, "Q-2#1": 2 }, "rater-a": { "Q-1#1": 4 } },
      ),
      run(
        "r2",
        { "Q-1#1": "pass", "Q-3#1": "fail" },
        { "rater-b": { "Q-1#1": 4, "Q-3#1": 1 }, "rater-a": { "Q-1#1": 4, "Q-3#1": 3 } },
      ),
    ]);
    expect(rows.map((row) => [row.comparison, row.result?.n, row.result?.kappa])).toEqual(
      [
        ["rater-a vs scorer (correctness; 4–5 = pass)", 3, 1],
        ["rater-b vs scorer (correctness; 4–5 = pass)", 4, 1],
        ["rater-a vs rater-b (five levels)", 3, rows[2]?.result?.kappa],
        ["rater-a vs rater-b (4–5 vs 1–3)", 3, 1],
      ],
    );
    // Five levels: (4,5) (4,4) (3,1). p_o = 1/3, p_e = 2/3 · 1/3 = 2/9, kappa = 1/7.
    expect(rows[2]?.result?.observed).toBeCloseTo(1 / 3, 12);
    expect(rows[2]?.result?.expected).toBeCloseTo(2 / 9, 12);
    expect(rows[2]?.result?.kappa).toBeCloseTo(1 / 7, 12);
  });

  test("a line the scorer did not score (n/a, human) is left out", () => {
    const rows = agreementRows([
      run("r1", { "Q-1#1": "pass" }, { "rater-b": { "Q-1#1": 5, "Q-9#1": 1 } }),
    ]);
    expect(rows[0]?.result?.n).toBe(1);
  });

  test("no raters: no rows", () => {
    expect(agreementRows([run("r1", { "Q-1#1": "pass" }, {})])).toEqual([]);
  });
});

describe("answerIdRows", () => {
  const SALT = "c".repeat(64);

  test("maps the rater's ids back to run, item and repeat", () => {
    const rows = answerIdRows("rater-b", SALT, "run-a", [
      { item_id: "Q-1", repeat: 1 },
      { item_id: "Q-2", repeat: 1 },
    ]);
    expect(rows.map((row) => [row.runId, row.itemId, row.repeat]).sort()).toEqual([
      ["run-a", "Q-1", 1],
      ["run-a", "Q-2", 1],
    ]);
    expect(rows.find((row) => row.itemId === "Q-1")?.id).toBe(
      lineToken(SALT, "run-a", "Q-1", 1),
    );
    expect(rows.map((row) => row.id)).toEqual(rows.map((row) => row.id).sort());
  });

  test("another salt gives other ids", () => {
    const line = [{ item_id: "Q-1", repeat: 1 }];
    expect(answerIdRows("rater-b", SALT, "run-a", line)[0]?.id).not.toBe(
      answerIdRows("rater-b", "d".repeat(64), "run-a", line)[0]?.id,
    );
  });
});

describe("agreement per set (#304)", () => {
  test("runs are grouped by set, in the order given, never pooled across sets", () => {
    const runs = [
      { set: "hb", runId: "hb-a" },
      { set: "v1h", runId: "v1h-a" },
      { set: "hb", runId: "hb-b" },
    ];
    expect(
      groupBySet(runs).map(([set, group]) => [set, group.map((run) => run.runId)]),
    ).toEqual([
      ["hb", ["hb-a", "hb-b"]],
      ["v1h", ["v1h-a"]],
    ]);
    expect(groupBySet([])).toEqual([]);
  });

  test("a ratings file counts only in a run of its rubric's set", () => {
    expect(ratedSetForFile("hb", "second-rater.v1")).toBe("hb");
    expect(ratedSetForFile("v1h", "second-rater.v1h.v1")).toBe("v1h");
    expect(ratedSetForFile("v1h", "second-rater.v1")).toBeNull();
    expect(ratedSetForFile("hb", "second-rater.v1h.v1")).toBeNull();
    expect(ratedSetForFile("v1", "second-rater.v1")).toBeNull();
  });

  test("per set, each set's raters are compared on that set's lines only", () => {
    const hb = {
      runId: "hb-a",
      scorer: new Map([["Q-1#1", "pass" as const]]),
      raters: new Map([["rater-b", new Map([["Q-1#1", 5]])]]),
    };
    const v1h = {
      runId: "v1h-a",
      scorer: new Map([
        ["Q-S1-H01#1", "fail" as const],
        ["Q-S1-H02#1", "pass" as const],
      ]),
      raters: new Map([
        [
          "rater-b",
          new Map([
            ["Q-S1-H01#1", 2],
            ["Q-S1-H02#1", 4],
          ]),
        ],
      ]),
    };
    const rows = groupBySet([
      { set: "hb", input: hb },
      { set: "v1h", input: v1h },
    ]).map(([set, group]) => [
      set,
      agreementRows(group.map((run) => run.input)).map((row) => row.result?.n),
    ]);
    expect(rows).toEqual([
      ["hb", [1]],
      ["v1h", [2]],
    ]);
  });
});

describe("restrictToLines (#413)", () => {
  test("keeps the scorer and every rater on the given lines only", () => {
    const run = {
      runId: "run-a",
      scorer: new Map([
        ["Q-1#1", "pass" as const],
        ["Q-2#1", "fail" as const],
      ]),
      raters: new Map([
        [
          "rater-b",
          new Map([
            ["Q-1#1", 5],
            ["Q-2#1", 1],
            ["Q-3#1", 4],
          ]),
        ],
      ]),
    };
    const kept = restrictToLines(run, new Set(["Q-1#1", "Q-3#1"]));
    expect([...kept.scorer.keys()]).toEqual(["Q-1#1"]);
    expect([...(kept.raters.get("rater-b")?.keys() ?? [])]).toEqual(["Q-1#1", "Q-3#1"]);
    expect(agreementRows([kept])[0]?.result?.n).toBe(1);
  });
});

describe("strataRows (#413)", () => {
  test("counts sampled lines per scenario and outcome", () => {
    const line = (scenario: string, outcome: "pass" | "fail" | "human" | "unscored") => ({
      runId: "run-a",
      itemId: `Q-${scenario}`,
      repeat: 1,
      scenario,
      outcome,
    });
    expect(
      strataRows([
        line("S5", "pass"),
        line("S1", "pass"),
        line("S1", "fail"),
        line("S1", "human"),
        line("S5", "unscored"),
      ]),
    ).toEqual([
      {
        scenario: "S1",
        counts: { pass: 1, fail: 1, human: 1, na: 0, unscored: 0 },
        total: 3,
      },
      {
        scenario: "S5",
        counts: { pass: 1, fail: 0, human: 0, na: 0, unscored: 1 },
        total: 2,
      },
    ]);
  });
});

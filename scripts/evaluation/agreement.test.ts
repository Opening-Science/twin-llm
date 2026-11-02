import { describe, expect, test } from "bun:test";

import { lineToken } from "../../features/lab/rater-lines";

import {
  agreementRows,
  answerIdRows,
  cohenKappa,
  groupBySet,
  pairsFromTable,
  ratedSetForFile,
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

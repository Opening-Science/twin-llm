import { describe, expect, test } from "bun:test";

import { parseAfFactor, parseArgs, parseBatches, USAGE } from "./args";

describe("parseBatches", () => {
  test("ranges, lists and single numbers become sorted three-digit ids", () => {
    expect(parseBatches("003,001-002,2")).toEqual(["001", "002", "003"]);
    expect(parseBatches("100")).toEqual(["100"]);
  });

  test("bad specs say what is wrong", () => {
    expect(parseBatches("5-3")).toBe("--batches range 5-3 runs backwards.");
    expect(parseBatches("000-002")).toBe("--batches are 001 to 100 (got: 000-002).");
    expect(parseBatches("a")).toBe(
      "--batches must look like 001-005 or 001,003 (got: a).",
    );
  });
});

describe("parseArgs", () => {
  test("defaults: batch 001, two jobs, seed 250", () => {
    expect(parseArgs([])).toEqual({
      batches: ["001"],
      archives: "../synthea-1m-v2/batches",
      out: "research-out/heart-brain",
      jobs: 2,
      seed: 250,
      controlsPerExposed: 4,
      permutations: 50,
      historyYears: 10,
      afFactor: 1,
      fresh: false,
    });
  });

  test("flags override the defaults", () => {
    expect(
      parseArgs([
        "--batches",
        "001-005",
        "--out",
        "/tmp/x",
        "--jobs",
        "5",
        "--seed",
        "7",
        "--controls",
        "2",
        "--permutations",
        "0",
        "--history-years",
        "0",
        "--af-factor",
        "2",
        "--fresh",
      ]),
    ).toEqual({
      batches: ["001", "002", "003", "004", "005"],
      archives: "../synthea-1m-v2/batches",
      out: "/tmp/x",
      jobs: 5,
      seed: 7,
      controlsPerExposed: 2,
      permutations: 0,
      historyYears: 0,
      afFactor: 2,
      fresh: true,
    });
  });

  test("bad values say what is wrong", () => {
    expect(parseArgs(["--jobs", "0"])).toBe(
      "--jobs must be a whole number from 1 (got: 0).",
    );
    expect(parseArgs(["--out"])).toBe("--out needs a directory.");
    expect(parseArgs(["--help"])).toBe(USAGE);
    expect(parseArgs(["--af-factor", "0"])).toBe(
      "--af-factor must be a number above 0 (got: 0).",
    );
    expect(parseArgs(["--af-factor"])).toBe(
      "--af-factor must be a number above 0 (got: ).",
    );
  });

  test("--af-factor takes decimals", () => {
    expect(parseAfFactor(["--af-factor", "1.5"])).toBe(1.5);
    expect(parseAfFactor([])).toBe(1);
  });
});

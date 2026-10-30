import { describe, expect, test } from "bun:test";

import { DEFAULT_RESAMPLES, DEFAULT_SEEDS, parseArgs } from "./args";

describe("parseArgs", () => {
  test("defaults", () => {
    expect(parseArgs(["--out", "x"])).toEqual({
      out: "x",
      seeds: DEFAULT_SEEDS,
      afdb: null,
      resamples: DEFAULT_RESAMPLES,
      bootstrapSeed: 249,
      quick: false,
      realNoise: false,
    });
  });

  test("every option", () => {
    expect(
      parseArgs([
        "--out",
        "o",
        "--seeds",
        "3",
        "--afdb",
        "d",
        "--resamples",
        "0",
        "--bootstrap-seed",
        "7",
        "--quick",
        "--real-noise",
      ]),
    ).toEqual({
      out: "o",
      seeds: 3,
      afdb: "d",
      resamples: 0,
      bootstrapSeed: 7,
      quick: true,
      realNoise: true,
    });
  });

  test("bad input throws", () => {
    expect(() => parseArgs([])).toThrow("--out is required");
    expect(() => parseArgs(["--out", "o", "--seeds", "0"])).toThrow(
      "--seeds must be an integer",
    );
    expect(() => parseArgs(["--out", "o", "--seeds", "1.5"])).toThrow(
      "--seeds must be an integer",
    );
    expect(() => parseArgs(["--out", "o", "--sedes", "2"])).toThrow(
      "unknown option --sedes",
    );
    expect(() => parseArgs(["--out", "o", "--afdb", "--quick"])).toThrow(
      "--afdb needs a directory",
    );
    expect(() => parseArgs(["--out", "o", "--real-noise"])).toThrow(
      "--real-noise needs the database",
    );
  });
});

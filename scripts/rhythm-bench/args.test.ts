import { describe, expect, test } from "bun:test";

import { DEFAULT_RESAMPLES, DEFAULT_SEEDS, parseArgs } from "./args";

describe("parseArgs", () => {
  test("defaults", () => {
    expect(parseArgs(["--out", "x"])).toEqual({
      out: "x",
      seeds: DEFAULT_SEEDS,
      database: null,
      resamples: DEFAULT_RESAMPLES,
      bootstrapSeed: 249,
      quick: false,
      realNoise: false,
      afDependence: "independent",
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
        "--af-dependence",
        "short_range",
      ]),
    ).toEqual({
      out: "o",
      seeds: 3,
      database: { id: "afdb", dir: "d" },
      resamples: 0,
      bootstrapSeed: 7,
      quick: true,
      realNoise: true,
      afDependence: "short_range",
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
    expect(() => parseArgs(["--out", "o", "--ltafdb"])).toThrow(
      "--ltafdb needs a directory",
    );
    expect(() => parseArgs(["--out", "o", "--afdb", "a", "--ltafdb", "b"])).toThrow(
      "give one database",
    );
    expect(() => parseArgs(["--out", "o", "--af-dependence", "ar2"])).toThrow(
      "--af-dependence takes independent or short_range",
    );
    expect(() => parseArgs(["--out", "o", "--af-dependence"])).toThrow(
      "--af-dependence takes",
    );
  });

  test("the long-term AF database", () => {
    expect(parseArgs(["--out", "o", "--ltafdb", "lt", "--real-noise"]).database).toEqual({
      id: "ltafdb",
      dir: "lt",
    });
  });
});

import { describe, expect, test } from "bun:test";

import {
  DEFAULT_BOOTSTRAP_SEED,
  DEFAULT_RESAMPLES,
  DEFAULT_SUBJECTS,
  parseArgs,
} from "./args";

describe("parseArgs", () => {
  test("defaults", () => {
    expect(parseArgs(["--out", "o"])).toEqual({
      out: "o",
      subjects: DEFAULT_SUBJECTS,
      afdb: null,
      ltafdb: null,
      resamples: DEFAULT_RESAMPLES,
      bootstrapSeed: DEFAULT_BOOTSTRAP_SEED,
    });
  });

  test("both databases and numbers", () => {
    expect(
      parseArgs([
        "--out",
        "o",
        "--subjects",
        "5",
        "--afdb",
        "a",
        "--ltafdb",
        "l",
        "--resamples",
        "0",
        "--bootstrap-seed",
        "7",
      ]),
    ).toEqual({
      out: "o",
      subjects: 5,
      afdb: "a",
      ltafdb: "l",
      resamples: 0,
      bootstrapSeed: 7,
    });
  });

  test("errors", () => {
    expect(() => parseArgs([])).toThrow("--out is required");
    expect(() => parseArgs(["--out", "o", "--seeds", "3"])).toThrow(
      "unknown option --seeds",
    );
    expect(() => parseArgs(["--out", "o", "--subjects", "1"])).toThrow("at least 2");
    expect(() => parseArgs(["--out", "o", "--afdb"])).toThrow("--afdb needs a value");
  });
});

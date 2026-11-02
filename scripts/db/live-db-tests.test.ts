import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  checkLiveDbRun,
  EXCLUDED_LIVE_TESTS,
  EXPECTED_LIVE_DB_TESTS,
  LIVE_DB_TESTS,
  parseBunTestSummary,
  unlistedLiveTests,
} from "./live-db-tests";

const REPO = join(import.meta.dir, "../..");

const OUTPUT = `
features/gbd/gbd-import-routes.live.test.ts:
(pass) GBD import routes > one [12.00ms]

 17 pass
 2 skip
 1 fail
 40 expect() calls
Ran 20 tests across 4 files. [1.20s]
`;

describe("parseBunTestSummary", () => {
  test("reads pass, skip and fail", () => {
    expect(parseBunTestSummary(OUTPUT)).toEqual({ pass: 17, fail: 1, skip: 2, todo: 0 });
  });

  test("a missing line counts as zero", () => {
    expect(parseBunTestSummary(" 3 pass\n 0 fail\n")).toEqual({
      pass: 3,
      fail: 0,
      skip: 0,
      todo: 0,
    });
  });
});

describe("checkLiveDbRun", () => {
  const clean = { pass: 17, fail: 0, skip: 0, todo: 0 };

  test("passes the expected run", () => {
    expect(checkLiveDbRun(clean, 0, 17)).toEqual([]);
  });

  test("a skipped test fails the run even when bun exits 0", () => {
    expect(checkLiveDbRun({ ...clean, pass: 15, skip: 2 }, 0, 17)).toEqual([
      "2 skipped",
      "15 passed, expected 17",
    ]);
  });

  test("fails on a nonzero exit or a failed test", () => {
    expect(checkLiveDbRun({ ...clean, pass: 16, fail: 1 }, 1, 17)).toEqual([
      "bun test exited with 1",
      "1 failed",
      "16 passed, expected 17",
    ]);
  });

  test("fails when nothing ran", () => {
    expect(checkLiveDbRun({ pass: 0, fail: 0, skip: 0, todo: 0 }, 0, 17)).toEqual([
      "0 passed, expected 17",
    ]);
  });
});

describe("unlistedLiveTests", () => {
  test("names a file in neither list", () => {
    expect(
      unlistedLiveTests([LIVE_DB_TESTS[0].file, "packages/new/thing.live.test.ts"]),
    ).toEqual(["packages/new/thing.live.test.ts"]);
  });

  test("every live test file is run or excluded with a reason", async () => {
    const listed = Bun.spawnSync(["git", "ls-files", "*.test.ts"], { cwd: REPO });
    const self = "scripts/db/live-db-tests.test.ts";
    const files = listed.stdout
      .toString()
      .split("\n")
      .filter((file) => file !== "" && file !== self);
    const reading = (
      await Promise.all(
        files.map(async (file) =>
          (await readFile(join(REPO, file), "utf8")).includes("RUN_LIVE") ? file : null,
        ),
      )
    ).filter((file): file is string => file !== null);
    expect(reading.length).toBeGreaterThan(0);
    expect(unlistedLiveTests(reading)).toEqual([]);
  });

  test("the run list and the exclusions do not overlap and name real files", async () => {
    for (const entry of LIVE_DB_TESTS) {
      expect(EXCLUDED_LIVE_TESTS[entry.file]).toBeUndefined();
    }
    for (const file of [
      ...LIVE_DB_TESTS.map((entry) => entry.file),
      ...Object.keys(EXCLUDED_LIVE_TESTS),
    ]) {
      expect(await Bun.file(join(REPO, file)).exists()).toBe(true);
    }
    expect(EXPECTED_LIVE_DB_TESTS).toBe(17);
  });
});

import { describe, expect, test } from "bun:test";

import { parseFetchArgs, parseIngestArgs } from "./args";
import { LITERATURE_LICENCES } from "./licence";

describe("parseFetchArgs", () => {
  test("reads specialty and limit, after a bare --", () => {
    expect(parseFetchArgs(["--", "--specialty", "diet", "--limit", "50"])).toEqual({
      ok: true,
      value: { specialty: "diet", limit: 50, allow: LITERATURE_LICENCES, dryRun: false },
    });
  });

  test("reads the other options", () => {
    expect(
      parseFetchArgs([
        "--specialty=sleep",
        "--limit=3",
        "--dry-run",
        "--allow",
        "CC0,cc-by",
        "--query",
        '"insomnia"[mesh]',
        "--email",
        "dev@example.org",
      ]),
    ).toEqual({
      ok: true,
      value: {
        specialty: "sleep",
        limit: 3,
        allow: ["cc0", "cc-by"],
        dryRun: true,
        query: '"insomnia"[mesh]',
        email: "dev@example.org",
      },
    });
  });

  test("defaults the limit to 20", () => {
    const parsed = parseFetchArgs(["--specialty", "gp"]);
    expect(parsed.ok && parsed.value.limit).toBe(20);
  });

  test.each([
    [[], "--specialty must be one of gp, diet, anatomy, sleep, trainer, genetics"],
    [
      ["--specialty", "cardio"],
      "--specialty must be one of gp, diet, anatomy, sleep, trainer, genetics",
    ],
    [
      ["--specialty", "diet", "--limit", "0"],
      "--limit must be a whole number from 1 to 500",
    ],
    [
      ["--specialty", "diet", "--limit", "2.5"],
      "--limit must be a whole number from 1 to 500",
    ],
    [
      ["--specialty", "diet", "--allow", "tdm"],
      "--allow takes a comma list of cc0, cc-by, cc-by-sa, cc-by-nd, cc-by-nc, cc-by-nc-sa, cc-by-nc-nd",
    ],
    [["--specialty", "diet", "--email", "nobody"], "--email must be an email address"],
    [["--specialty", "diet", "--api-key", "x"], "unknown option --api-key"],
    [["diet"], "unexpected argument diet"],
  ])("%j is refused", (argv, error) => {
    expect(parseFetchArgs(argv)).toEqual({ ok: false, error });
  });
});

describe("parseIngestArgs", () => {
  test("no options ingests every specialty", () => {
    expect(parseIngestArgs([])).toEqual({ ok: true, value: {} });
  });

  test("one specialty", () => {
    expect(parseIngestArgs(["--", "--specialty", "genetics"])).toEqual({
      ok: true,
      value: { specialty: "genetics" },
    });
  });

  test("refuses unknown options and specialties", () => {
    expect(parseIngestArgs(["--limit", "3"])).toEqual({
      ok: false,
      error: "unknown option --limit",
    });
    expect(parseIngestArgs(["--specialty", "x"])).toEqual({
      ok: false,
      error: "--specialty must be one of gp, diet, anatomy, sleep, trainer, genetics",
    });
  });
});

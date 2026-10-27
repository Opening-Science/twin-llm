import { describe, expect, test } from "bun:test";

import { parseNumCtx } from "./detect";
import {
  databaseTarget,
  defaultDatabaseUrl,
  envFileFromExample,
  EXAMPLE_DATABASE_URL,
  parseEnvFile,
  redactUrl,
} from "./env-file";
import { parseIngestSummary, sha256For } from "./ingest-summary";
import { parseSetupArgs } from "./local";
import { checkTool, parseVersion } from "./prerequisites";

describe("parseVersion", () => {
  test("reads the version each tool prints", () => {
    expect(parseVersion("java", 'openjdk version "21.0.12" 2026-07-15')).toEqual([
      21, 0, 12,
    ]);
    expect(parseVersion("java", 'java version "1.8.0_402"')).toEqual([8, 0, 0]);
    expect(
      parseVersion("zstd", "*** Zstandard CLI (64-bit) v1.5.7, by Yann Collet ***"),
    ).toEqual([1, 5, 7]);
    expect(parseVersion("node", "v26.7.0")).toEqual([26, 7, 0]);
    expect(parseVersion("java", "Unable to locate a Java Runtime.")).toBeNull();
  });
});

describe("checkTool", () => {
  test("too old, missing and fine", () => {
    expect(checkTool("bun", { output: "1.3.9" }, "linux")).toEqual({
      id: "bun",
      status: "too-old",
      detail: "Bun 1.3.9 found, 1.4.2 or newer needed",
      fix: "curl -fsSL https://bun.sh/install | bash",
    });
    expect(checkTool("uv", { output: null }, "darwin")).toEqual({
      id: "uv",
      status: "missing",
      detail: "uv not found",
      fix: "brew install uv",
    });
    expect(checkTool("node", { output: "v26.0.0" }, "darwin")).toEqual({
      id: "node",
      status: "ok",
      version: "26.0.0",
    });
  });
});

describe("env file", () => {
  test("parses KEY=value lines and ignores comments", () => {
    expect(parseEnvFile('# c\nDATA_MODE=synthetic\n\nexport A="b c"\nNOPE\n')).toEqual({
      DATA_MODE: "synthetic",
      A: "b c",
    });
  });

  test("a new .env.local takes the shell URL, Homebrew's default on macOS, else the placeholder", () => {
    expect(defaultDatabaseUrl("linux", "postgresql://p:q@h:5432/d", "mia")).toBe(
      "postgresql://p:q@h:5432/d",
    );
    expect(defaultDatabaseUrl("darwin", undefined, "peter")).toBe(
      "postgresql://peter@127.0.0.1:5432/twin_llm_synthetic",
    );
    expect(defaultDatabaseUrl("linux", undefined, "mia")).toBe(EXAMPLE_DATABASE_URL);
  });

  test("only the DATABASE_URL line changes", () => {
    expect(
      envFileFromExample(
        "A=1\nDATABASE_URL=x\n# DATABASE_URL=y\n",
        "postgresql://u@h/db",
      ),
    ).toBe("A=1\nDATABASE_URL=postgresql://u@h/db\n# DATABASE_URL=y\n");
  });

  test("databaseTarget gives the name and the maintenance URL, and refuses odd names", () => {
    expect(
      databaseTarget("postgresql://postgres:pw@127.0.0.1:5432/twin_llm_setup_test"),
    ).toEqual({
      name: "twin_llm_setup_test",
      maintenanceUrl: "postgresql://postgres:pw@127.0.0.1:5432/postgres",
    });
    expect(databaseTarget('postgresql://u@h/x";drop')).toBeNull();
    expect(databaseTarget("mysql://u@h/db")).toBeNull();
  });

  test("redactUrl hides the password", () => {
    expect(redactUrl("postgresql://postgres:secret@127.0.0.1:5432/db")).toBe(
      "postgresql://postgres:***@127.0.0.1:5432/db",
    );
  });
});

describe("ingest output", () => {
  test("parseIngestSummary reads the totals line", () => {
    expect(
      parseIngestSummary(
        "a.json: inserted 3 rows\n\nBundles: 33 inserted, 0 already ingested, 2 rejected\n",
      ),
    ).toEqual({
      inserted: 33,
      skipped: 0,
      rejected: 2,
    });
    expect(parseIngestSummary("Refused, nothing written")).toBeNull();
  });

  test("sha256For finds the archive's line", () => {
    const sums =
      "dc906bc6abd809b4590952920beb3198ae5bb46eef5cf824bc72c9325934e024  synthea-v4-seed42-10k-fhir.tar.zst\n";
    expect(sha256For(sums, "synthea-v4-seed42-10k-fhir.tar.zst")).toBe(
      "dc906bc6abd809b4590952920beb3198ae5bb46eef5cf824bc72c9325934e024",
    );
    expect(sha256For(sums, "other.tar.zst")).toBeNull();
  });
});

describe("parseSetupArgs", () => {
  test("flags", () => {
    const eval_ = {
      cohort: "eval",
      reloadCohort: false,
      generateCohort: false,
      skipExample: false,
    };
    expect(parseSetupArgs([])).toEqual(eval_);
    expect(parseSetupArgs(["--", "--cohort-10k"])).toEqual({ ...eval_, cohort: "10k" });
    expect(parseSetupArgs(["--skip-cohort"])).toEqual({ ...eval_, cohort: "none" });
    expect(parseSetupArgs(["--", "--reload-cohort"])).toEqual({
      ...eval_,
      reloadCohort: true,
    });
    expect(parseSetupArgs(["--cohort-10k", "--skip-cohort"])).toBeNull();
    expect(parseSetupArgs(["--reload-cohort", "--skip-cohort"])).toBeNull();
    expect(parseSetupArgs(["--reload-cohort", "--cohort-10k"])).toBeNull();
    expect(parseSetupArgs(["--yes"])).toBeNull();
  });

  test("--skip-example goes with any cohort choice", () => {
    expect(parseSetupArgs(["--", "--skip-example"])).toEqual({
      cohort: "eval",
      reloadCohort: false,
      generateCohort: false,
      skipExample: true,
    });
    expect(parseSetupArgs(["--skip-cohort", "--skip-example"])).toEqual({
      cohort: "none",
      reloadCohort: false,
      generateCohort: false,
      skipExample: true,
    });
  });

  test("--generate-cohort goes with the evaluation cohort, alone or with --reload-cohort", () => {
    expect(parseSetupArgs(["--", "--generate-cohort"])).toEqual({
      cohort: "eval",
      reloadCohort: false,
      generateCohort: true,
      skipExample: false,
    });
    expect(parseSetupArgs(["--reload-cohort", "--generate-cohort"])).toEqual({
      cohort: "eval",
      reloadCohort: true,
      generateCohort: true,
      skipExample: false,
    });
    expect(parseSetupArgs(["--generate-cohort", "--cohort-10k"])).toBeNull();
    expect(parseSetupArgs(["--generate-cohort", "--skip-cohort"])).toBeNull();
  });
});

describe("parseNumCtx", () => {
  test("reads OLLAMA_NUM_CTX the way the app does", () => {
    expect(parseNumCtx(undefined)).toBe(16_384);
    expect(parseNumCtx(" ")).toBe(16_384);
    expect(parseNumCtx("32768")).toBe(32_768);
    expect(parseNumCtx("4096")).toBeNull();
    expect(parseNumCtx("16k")).toBeNull();
  });
});

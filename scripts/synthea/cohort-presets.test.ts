import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { DEMO_COHORTS, SYNTHETIC_COHORTS } from "../../packages/query-tools/scope";

import {
  batchCohort,
  COHORT_PRESETS,
  type CohortPresetName,
  EVALUATION_COHORT_IDS,
  SYNTHEA_1M_BATCH_COHORTS,
} from "./cohort-presets";

const SCRIPT = join(import.meta.dir, "generate-local.sh");

/** The script's resolved settings, without Java or a download. */
const dryRun = (args: readonly string[], env: Record<string, string> = {}) => {
  const run = Bun.spawnSync(["bash", SCRIPT, ...args, "--dry-run"], {
    env: { PATH: Bun.env.PATH ?? "", ...env },
    // --dry-run never starts Java; a hang would mean it did.
    timeout: 10_000,
  });
  return {
    code: run.exitCode,
    out: run.stdout.toString().trim(),
    err: run.stderr.toString().trim(),
  };
};

describe("generate-local.sh presets", () => {
  test("defaults are unchanged: N=10, seed 42, .synthea", () => {
    expect(dryRun([]).out).toBe(
      "preset=none cohort=synthea-v4-seed42 population=10 seed=42 clinicianSeed=43 age=any out=.synthea",
    );
  });

  test.each(Object.keys(COHORT_PRESETS) as CohortPresetName[])(
    "%s matches cohort-presets.ts",
    (name) => {
      const preset = COHORT_PRESETS[name];
      expect(dryRun(["--preset", name]).out).toBe(
        `preset=${name} cohort=${preset.cohortId} population=${preset.population} seed=${preset.seed} clinicianSeed=${preset.clinicianSeed} age=${preset.age} out=${preset.out}`,
      );
    },
  );

  test("flags win over env, env over the preset", () => {
    expect(dryRun(["--preset", "training", "--population", "12"]).out).toBe(
      "preset=training cohort=synthea-v4-seed4242 population=12 seed=4242 clinicianSeed=4243 age=40-75 out=.synthea/synthea-v4-seed4242",
    );
    expect(dryRun(["--preset", "held-out"], { SYNTHEA_POPULATION: "7" }).out).toBe(
      "preset=held-out cohort=synthea-v4-seed9001 population=7 seed=9001 clinicianSeed=9002 age=40-75 out=.synthea/synthea-v4-seed9001",
    );
    expect(dryRun(["--seed", "7", "--age", "18-30"]).out).toBe(
      "preset=none cohort=synthea-v4-seed7 population=10 seed=7 clinicianSeed=43 age=18-30 out=.synthea/synthea-v4-seed7",
    );
  });

  test("only the evaluation cohort writes to .synthea/fhir", () => {
    expect(dryRun(["--seed", "42", "--population", "3"]).out).toBe(
      "preset=none cohort=synthea-v4-seed42 population=3 seed=42 clinicianSeed=43 age=any out=.synthea",
    );
    expect(dryRun(["--seed", "4242"]).out).toBe(
      "preset=none cohort=synthea-v4-seed4242 population=10 seed=4242 clinicianSeed=43 age=any out=.synthea/synthea-v4-seed4242",
    );
  });

  test("refuses a seed that conflicts with the preset", () => {
    expect(dryRun(["--preset", "training", "--seed", "7"])).toEqual({
      code: 1,
      out: "",
      err: "synthea: seed 7 conflicts with preset training (seed 4242); drop --seed or SYNTHEA_SEED",
    });
    expect(dryRun(["--preset", "eval"], { SYNTHEA_SEED: "9001" }).err).toBe(
      "synthea: seed 9001 conflicts with preset eval (seed 42); drop --seed or SYNTHEA_SEED",
    );
    expect(dryRun(["--preset", "held-out"], { SYNTHEA_SEED: "9001" }).code).toBe(0);
  });

  test("a flag without a value says so", () => {
    expect(dryRun(["--preset"])).toEqual({
      code: 1,
      out: "",
      err: "synthea: --preset needs a value",
    });
    expect(dryRun(["--seed"]).err).toBe("synthea: --seed needs a value");
  });

  test("refuses bad values with a plain message", () => {
    expect(dryRun(["--population", "0"])).toEqual({
      code: 1,
      out: "",
      err: "synthea: population must be a positive whole number (got: 0)",
    });
    expect(dryRun(["--preset", "big"]).err).toBe(
      "synthea: unknown preset: big (eval, training or held-out)",
    );
    expect(dryRun(["--age", "4075"]).err).toBe(
      "synthea: age must look like 40-75 (got: 4075)",
    );
  });

  test("every preset cohort is on the query-tool allowlist", () => {
    const ids = Object.values(COHORT_PRESETS).map((preset) => preset.cohortId);
    expect(
      ids.filter((id) => !(SYNTHETIC_COHORTS as readonly string[]).includes(id)),
    ).toEqual([]);
  });
});

describe("1M cohort batches", () => {
  const ids = SYNTHEA_1M_BATCH_COHORTS.map((batch) => batch.cohortId);

  test("one cohort per seed from 1001 to 1100, in order", () => {
    expect(ids.length).toBe(100);
    expect(ids.slice(0, 3)).toEqual([
      "synthea-v4-seed1001",
      "synthea-v4-seed1002",
      "synthea-v4-seed1003",
    ]);
    expect(ids.slice(-2)).toEqual(["synthea-v4-seed1099", "synthea-v4-seed1100"]);
    expect(SYNTHEA_1M_BATCH_COHORTS.map((batch) => batch.seed)).toEqual(
      Array.from({ length: 100 }, (_, index) => 1001 + index),
    );
    expect(new Set(ids).size).toBe(100);
  });

  test("1001 to 1099 are training, 1100 is held out", () => {
    expect(batchCohort(1001)).toEqual({
      cohortId: "synthea-v4-seed1001",
      role: "training",
      seed: 1001,
      clinicianSeed: 2001,
      population: 10_000,
      age: "any",
      archive: "batch-001.tar.zst",
    });
    expect(batchCohort(1099)).toEqual({
      cohortId: "synthea-v4-seed1099",
      role: "training",
      seed: 1099,
      clinicianSeed: 2099,
      population: 10_000,
      age: "any",
      archive: "batch-099.tar.zst",
    });
    expect(batchCohort(1100)).toEqual({
      cohortId: "synthea-v4-seed1100",
      role: "held-out",
      seed: 1100,
      clinicianSeed: 2100,
      population: 10_000,
      age: "any",
      archive: "batch-100.tar.zst",
    });
    expect(
      SYNTHEA_1M_BATCH_COHORTS.filter((batch) => batch.role === "held-out").map(
        (batch) => batch.cohortId,
      ),
    ).toEqual(["synthea-v4-seed1100"]);
    expect(
      SYNTHEA_1M_BATCH_COHORTS.filter((batch) => batch.role === "training").length,
    ).toBe(99);
  });

  test("a seed outside the batches is not a batch", () => {
    expect(batchCohort(1000)).toBeNull();
    expect(batchCohort(1101)).toBeNull();
    expect(batchCohort(42)).toBeNull();
    expect(batchCohort(4242)).toBeNull();
  });

  test("no batch shares a seed or cohort with a preset", () => {
    const presets = Object.values(COHORT_PRESETS);
    const presetSeeds = presets.flatMap((preset) => [preset.seed, preset.clinicianSeed]);
    const batchSeeds = SYNTHEA_1M_BATCH_COHORTS.flatMap((batch) => [
      batch.seed,
      batch.clinicianSeed,
    ]);
    expect(batchSeeds.filter((seed) => presetSeeds.includes(seed))).toEqual([]);
    expect(ids.filter((id) => presets.some((preset) => preset.cohortId === id))).toEqual(
      [],
    );
    expect(ids.filter((id) => EVALUATION_COHORT_IDS.includes(id))).toEqual([]);
  });

  test("every batch is on the allowlist and none is a Demo cohort", () => {
    expect(
      ids.filter((id) => !(SYNTHETIC_COHORTS as readonly string[]).includes(id)),
    ).toEqual([]);
    expect(ids.filter((id) => (DEMO_COHORTS as readonly string[]).includes(id))).toEqual(
      [],
    );
  });
});

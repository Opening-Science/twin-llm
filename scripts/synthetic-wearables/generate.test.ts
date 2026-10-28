import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { parseWearablesArgs, runGenerateWearables, type WearablesDeps } from "./generate";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(import.meta.dir, "../../tests/fixtures/synthea", name), "utf8"),
  ) as unknown;

const harness = (files: Record<string, unknown>) => {
  const written = new Map<string, unknown>();
  const out: string[] = [];
  const err: string[] = [];
  const deps: WearablesDeps = {
    listJson: async (dir) =>
      dir === "/c/fhir"
        ? Object.keys(files)
            .filter((path) => path.startsWith("/c/fhir/"))
            .sort()
        : null,
    readJson: async (path) => files[path] ?? null,
    writeJson: async (path, value) => {
      written.set(path, value);
    },
  };
  const io = {
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => err.push(chunk) },
  };
  return { deps, io, written, out, err };
};

describe("parseWearablesArgs", () => {
  test("defaults the output next to the input", () => {
    expect(parseWearablesArgs(["--in", "/c/fhir"])).toEqual({
      input: "/c/fhir",
      output: "/c/wearables",
      seed: null,
      endDay: "2026-10-01",
      days: 90,
      allowEvalCohort: false,
    });
    expect(parseWearablesArgs(["--in", "/c/fhir", "--allow-eval-cohort"])).toEqual({
      input: "/c/fhir",
      output: "/c/wearables",
      seed: null,
      endDay: "2026-10-01",
      days: 90,
      allowEvalCohort: true,
    });
  });

  test("refuses bad flags with a plain message", () => {
    expect(parseWearablesArgs([])).toBe(
      "Usage: bun run wearables:generate -- --in <synthea fhir dir>",
    );
    expect(parseWearablesArgs(["--in", "x", "--days", "0"])).toBe(
      "--days must be a whole number from 1 to 730.",
    );
    expect(parseWearablesArgs(["--in", "x", "--end", "1 Oct"])).toBe(
      "--end must be a date like 2026-10-01.",
    );
    expect(parseWearablesArgs(["--in", "x", "--seed", "-1"])).toBe(
      "--seed must be a whole number.",
    );
  });
});

describe("runGenerateWearables", () => {
  test("writes one bundle per living subject and a manifest, seeded from the cohort", async () => {
    const h = harness({
      "/c/manifest.json": {
        seed: 4242,
        syntheaVersion: "v4.0.0",
        cohortId: "synthea-v4-seed4242",
      },
      "/c/fhir/patient-1.json": fixture("patient-1.json"),
      "/c/fhir/patient-2.json": fixture("patient-2.json"),
      "/c/fhir/hospitalInformation.json": { resourceType: "Bundle", entry: [] },
    });
    const code = await runGenerateWearables(
      ["--in", "/c/fhir", "--days", "5"],
      h.io,
      h.deps,
    );
    expect(code).toBe(0);
    expect([...h.written.keys()].sort()).toEqual([
      "/c/wearables/4f083ce3-f12b-bb4b-7353-e17f0cd55b0a.wearables.json",
      "/c/wearables/ba419d35-0dfe-8af7-347c-eebf02485a56.wearables.json",
      "/c/wearables/manifest.json",
    ]);
    expect(h.written.get("/c/wearables/manifest.json")).toEqual({
      generator: "twinllm-synthetic-wearables",
      generatorVersion: "2",
      cohortId: "synthea-v4-seed4242",
      seed: 4242,
      endDay: "2026-10-01",
      days: 5,
      subjects: 2,
      // 35 daily readings and one workout (4f083ce3, 29 Sep, running).
      readings: 36,
      syntheaVersion: "v4.0.0",
    });
    expect(h.out.join("")).toContain("Subjects: 2, deceased left out: 0, other files: 1");
  });

  test("refuses the evaluation cohort, also from an older manifest's seed", async () => {
    for (const manifest of [{ seed: 42, cohortId: "synthea-v4-seed42" }, { seed: 42 }]) {
      const h = harness({
        "/c/manifest.json": manifest,
        "/c/fhir/patient-1.json": fixture("patient-1.json"),
      });
      expect(await runGenerateWearables(["--in", "/c/fhir"], h.io, h.deps)).toBe(1);
      expect(h.err.join("")).toBe(
        "Refused: synthea-v4-seed42 is the evaluation cohort. Its series belong only in the throwaway answer-key and eval databases (docs/evaluation/question-set.md); pass --allow-eval-cohort for those.\n",
      );
      expect(h.written.size).toBe(0);
    }
  });

  test("writes the evaluation cohort's series with --allow-eval-cohort", async () => {
    const h = harness({
      "/c/manifest.json": { seed: 42, cohortId: "synthea-v4-seed42" },
      "/c/fhir/patient-1.json": fixture("patient-1.json"),
    });
    expect(
      await runGenerateWearables(
        ["--in", "/c/fhir", "--days", "5", "--allow-eval-cohort"],
        h.io,
        h.deps,
      ),
    ).toBe(0);
    expect([...h.written.keys()].sort()).toEqual([
      "/c/wearables/ba419d35-0dfe-8af7-347c-eebf02485a56.wearables.json",
      "/c/wearables/manifest.json",
    ]);
    expect(h.err.join("")).toBe("");
  });

  test("needs a seed when the cohort has no manifest", async () => {
    const h = harness({ "/c/fhir/patient-1.json": fixture("patient-1.json") });
    expect(await runGenerateWearables(["--in", "/c/fhir"], h.io, h.deps)).toBe(1);
    expect(h.err.join("")).toBe(
      "No seed: pass --seed or keep manifest.json next to the fhir dir.\n",
    );
    expect(h.written.size).toBe(0);
  });

  test("refuses a missing directory", async () => {
    const h = harness({});
    expect(
      await runGenerateWearables(["--in", "/nope", "--seed", "1"], h.io, h.deps),
    ).toBe(1);
    expect(h.err.join("")).toBe("No such directory: /nope\n");
  });
});

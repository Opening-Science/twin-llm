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
      generatorVersion: "3.1",
    });
    expect(
      parseWearablesArgs([
        "--in",
        "/c/fhir",
        "--allow-eval-cohort",
        "--generator-version",
        "2",
      ]),
    ).toEqual({
      input: "/c/fhir",
      output: "/c/wearables",
      seed: null,
      endDay: "2026-10-01",
      days: 90,
      allowEvalCohort: true,
      generatorVersion: "2",
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
    expect(parseWearablesArgs(["--in", "x", "--generator-version", "1"])).toBe(
      "--generator-version must be 2 or 3.1.",
    );
    // 3.1 replaced 3 (#365): a "3" series cannot be rebuilt from this code.
    expect(parseWearablesArgs(["--in", "x", "--generator-version", "3"])).toBe(
      "--generator-version must be 2 or 3.1.",
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
      generatorVersion: "3.1",
      cohortId: "synthea-v4-seed4242",
      seed: 4242,
      endDay: "2026-10-01",
      days: 5,
      subjects: 2,
      // 5 worn days across both subjects x 11 daily metrics and one workout
      // (4f083ce3, 29 Sep, running); v2 had 7 daily metrics (36 readings).
      readings: 56,
      syntheaVersion: "v4.0.0",
      subjectsWithConditionEffect: {
        atrial_fibrillation: 0,
        heart_failure: 0,
        stroke: 0,
        sleep_apnea: 0,
      },
    });
    expect(h.out.join("")).toContain("Subjects: 2, deceased left out: 0, other files: 1");
  });

  test("follows a subject's conditions in v3 and ignores them with --generator-version 2", async () => {
    const base = fixture("patient-1.json") as { entry: unknown[] };
    const withAf = {
      ...base,
      entry: [
        ...base.entry,
        {
          resource: {
            resourceType: "Condition",
            code: { coding: [{ system: "http://snomed.info/sct", code: "49436004" }] },
            onsetDateTime: "2020-01-01T00:00:00Z",
          },
        },
      ],
    };
    const run = async (extra: string[]) => {
      const h = harness({
        "/c/manifest.json": { seed: 4242, cohortId: "synthea-v4-seed4242" },
        "/c/fhir/patient-1.json": withAf,
      });
      expect(
        await runGenerateWearables(
          ["--in", "/c/fhir", "--days", "5", ...extra],
          h.io,
          h.deps,
        ),
      ).toBe(0);
      const bundle = h.written.get(
        "/c/wearables/ba419d35-0dfe-8af7-347c-eebf02485a56.wearables.json",
      ) as { entry: { resource: { code?: { coding: { code: string }[] } } }[] };
      const codes = bundle.entry.flatMap(
        (entry) => entry.resource.code?.coding.map((coding) => coding.code) ?? [],
      );
      return { h, codes };
    };
    const v3 = await run([]);
    expect(v3.codes).toContain("af-burden");
    expect(v3.codes).toContain("irregular-rhythm-notification");
    expect(v3.h.out.join("")).toContain(
      "Living subjects with a condition effect: atrial fibrillation 1, heart failure 0, stroke 0, sleep apnea 0",
    );
    const v2 = await run(["--generator-version", "2"]);
    expect(v2.codes).not.toContain("af-burden");
    expect(v2.h.written.get("/c/wearables/manifest.json")).toMatchObject({
      generatorVersion: "2",
    });
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

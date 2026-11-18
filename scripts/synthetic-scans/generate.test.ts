import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SCAN_GENERATOR_ID } from "./bundle";
import { runGenerateScans } from "./generate";

const FIXTURES = join(import.meta.dir, "../../tests/fixtures/synthea");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const MEASURED = fixture("patient-2.json");
const UNMEASURED = fixture("patient-1.json");

describe("runGenerateScans", () => {
  const run = async (argv: readonly string[], manifest: unknown = null) => {
    const written = new Map<string, unknown>();
    const out: string[] = [];
    const err: string[] = [];
    const files: Record<string, unknown> = {
      "/c/fhir/patient-1.json": UNMEASURED,
      "/c/fhir/patient-2.json": MEASURED,
      "/c/fhir/patient-3.json": fixture("patient-3.json"),
      "/c/fhir/hospitalInformation.json": { resourceType: "Bundle", entry: [] },
    };
    const code = await runGenerateScans(
      argv,
      { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } },
      {
        listJson: async (dir) => (dir === "/c/fhir" ? Object.keys(files).sort() : null),
        readJson: async (path) =>
          path === "/c/manifest.json" ? manifest : (files[path] ?? null),
        writeJson: async (path, value) => {
          written.set(path, value);
        },
      },
    );
    return { code, written, out: out.join(""), err: err.join("") };
  };

  test("writes one scan per measured living subject and a manifest, next to the cohort", async () => {
    const { code, written, out } = await run(["--in", "/c/fhir"], {
      cohortId: "open-twin-synthea-trimmed-3",
    });
    expect(code).toBe(0);
    expect([...written.keys()].sort()).toEqual([
      "/c/scans/4f083ce3-f12b-bb4b-7353-e17f0cd55b0a.scan.json",
      expect.stringMatching(/^\/c\/scans\/.+\.scan\.json$/),
      "/c/scans/manifest.json",
    ]);
    expect(written.get("/c/scans/manifest.json")).toMatchObject({
      generator: SCAN_GENERATOR_ID,
      cohortId: "open-twin-synthea-trimmed-3",
      subjects: 2,
    });
    expect(out).toContain("Scans: 2, no height and weight: 1");
  });

  test("refuses the evaluation cohort unless asked", async () => {
    const refused = await run(["--in", "/c/fhir"], { cohortId: "synthea-v4-seed42" });
    expect(refused.code).toBe(1);
    expect(refused.written.size).toBe(0);
    expect(refused.err).toContain("evaluation cohort");
    const allowed = await run(["--in", "/c/fhir", "--allow-eval-cohort"], {
      cohortId: "synthea-v4-seed42",
    });
    expect(allowed.code).toBe(0);
  });

  test("refuses a cohort no manifest names unless asked", async () => {
    const refused = await run(["--in", "/c/fhir"]);
    expect(refused.code).toBe(1);
    expect(refused.written.size).toBe(0);
    expect(refused.err).toContain("no manifest.json next to /c/fhir names the cohort");
    const allowed = await run(["--in", "/c/fhir", "--allow-eval-cohort"]);
    expect(allowed.code).toBe(0);
    expect(allowed.written.get("/c/scans/manifest.json")).not.toHaveProperty("cohortId");
  });

  test("a missing directory or flag is a plain message", async () => {
    expect((await run([])).err).toContain("Usage");
    expect((await run(["--in", "/nope"])).err).toContain("No such directory");
  });
});

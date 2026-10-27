import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseCatalog, type Variant } from "./catalog";
import { genomeFor, parseGenerateArgs, runGenerate } from "./generate";
import {
  parseIngestArgs,
  releasedReport,
  runIngest,
  type SaveOutcome,
  type SyntheticRow,
  syntheticRow,
} from "./ingest";

const catalog = (): readonly Variant[] => {
  const parsed = parseCatalog(
    readFileSync(join(import.meta.dir, "variants.tsv"), "utf8"),
  );
  if (typeof parsed === "string") throw new Error(parsed);
  return parsed;
};

const REF = "080b069b-5108-46b6-ecef-6aacd3b9ef3f";
const OTHER = "a6b1639b-a2e1-abe3-0c15-ef67d7581e82";

const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: { write: (s: string) => void out.push(s) },
      stderr: { write: (s: string) => void err.push(s) },
    },
  };
};

const patientBundle = (id: string) => ({
  resourceType: "Bundle",
  entry: [
    {
      resource: {
        resourceType: "Patient",
        id,
        identifier: [{ system: "https://github.com/synthetichealth/synthea", value: id }],
      },
    },
  ],
});

describe("genome:synth", () => {
  test("takes UUID-shaped subject_refs only", () => {
    expect(parseGenerateArgs(["--subject", REF])).toEqual({
      subjects: [REF],
      out: "data/genome-synth/subjects",
    });
    expect(parseGenerateArgs(["--subject", "Peter Dike"])).toBe(
      "Not a synthetic subject_ref: Peter Dike.",
    );
    expect(parseGenerateArgs([])).toBe(
      "Usage: bun run genome:synth -- --subject <subject_ref>[,<subject_ref>] [--out <dir>]",
    );
  });

  test("writes a VCF and a report per subject and prints counts", async () => {
    const written = new Map<string, string>();
    const { out, io: streams } = io();
    const code = await runGenerate(
      ["--subject", `${REF},${OTHER}`, "--out", "x"],
      streams,
      {
        catalog: async () => catalog(),
        writeText: async (path, text) => void written.set(path, text),
      },
    );
    expect(code).toBe(0);
    expect([...written.keys()]).toEqual([
      `x/${REF}.vcf`,
      `x/${REF}.rsid-genotypes.tsv`,
      `x/${OTHER}.vcf`,
      `x/${OTHER}.rsid-genotypes.tsv`,
    ]);
    expect(written.get(`x/${REF}.vcf`)).toBe(genomeFor(REF, catalog()).vcf);
    expect(out[0]).toBe(`${REF}: 92 sites (66 hom ref, 16 het, 9 hom alt, 1 no call)\n`);
  });
});

describe("genome:ingest", () => {
  const deps = (files: Record<string, unknown>) => {
    const written = new Map<string, string>();
    const renamed: string[] = [];
    return {
      written,
      renamed,
      deps: {
        catalog: async () => catalog(),
        listJson: async (dir: string) =>
          dir === "c/fhir"
            ? Object.keys(files)
                .filter((p) => p.startsWith("c/fhir/"))
                .sort()
            : null,
        readJson: async (path: string) => files[path] ?? null,
        writeText: async (path: string, text: string) => void written.set(path, text),
        rename: async (from: string, to: string) => {
          const text = written.get(from);
          if (text !== undefined) written.set(to, text);
          written.delete(from);
          renamed.push(`${from} -> ${to}`);
        },
      },
    };
  };

  test("one released report per Synthea Patient, sorted by subject_ref", async () => {
    const fake = deps({
      "c/manifest.json": { seed: 4242, cohortId: "synthea-v4-seed4242" },
      "c/fhir/b.json": patientBundle(REF),
      "c/fhir/a.json": patientBundle(OTHER),
      "c/fhir/hospitalInformation.json": { resourceType: "Bundle", entry: [] },
    });
    const { out, io: streams } = io();
    expect(await runIngest(["--in", "c/fhir"], streams, fake.deps)).toBe(0);
    const path = "data/genome-synth/synthea-v4-seed4242.reports.jsonl";
    expect(fake.renamed).toEqual([`${path}.partial -> ${path}`]);
    const lines = (fake.written.get(path) ?? "")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toEqual([
      releasedReport(REF, "synthea-v4-seed4242", catalog()),
      releasedReport(OTHER, "synthea-v4-seed4242", catalog()),
    ]);
    expect(lines[0]).toMatchObject({
      subject_ref: REF,
      app: "rsid-genotypes",
      app_version: "0.1.0",
      catalog_version: "genome-synth-v1",
      synthetic: true,
    });
    expect(out.join("")).toContain(
      "Cohort synthea-v4-seed4242: 2 subjects, other files: 1",
    );
  });

  test("refuses a cohort outside the synthetic allowlist and a missing dir", async () => {
    const fake = deps({ "c/fhir/a.json": patientBundle(REF) });
    const first = io();
    expect(
      await runIngest(["--in", "c/fhir", "--cohort", "self"], first.io, fake.deps),
    ).toBe(1);
    expect(first.err).toEqual(['Cohort "self" is not an allowed synthetic cohort.\n']);
    const second = io();
    expect(await runIngest(["--in", "nowhere"], second.io, fake.deps)).toBe(1);
    expect(second.err).toEqual(["No such directory: nowhere\n"]);
    const third = io();
    expect(await runIngest(["--in", "c/fhir"], third.io, fake.deps)).toBe(1);
    expect(third.err).toEqual([
      "No cohort: pass --cohort or keep manifest.json next to the fhir dir.\n",
    ]);
    expect(fake.written.size).toBe(0);
  });

  describe("--to-db", () => {
    const FILES = {
      "c/manifest.json": { seed: 4242, cohortId: "synthea-v4-seed4242" },
      "c/fhir/a.json": patientBundle(REF),
      "c/fhir/b.json": patientBundle(OTHER),
    };
    const withDb = (outcome: (row: SyntheticRow) => SaveOutcome, mode = "synthetic") => {
      const fake = deps(FILES);
      const saved: SyntheticRow[] = [];
      return {
        ...fake,
        saved,
        deps: {
          ...fake.deps,
          dataMode: () => mode,
          save: async (row: SyntheticRow) => {
            saved.push(row);
            return outcome(row);
          },
        },
      };
    };

    test("writes each report through the store as a parsed synthetic row, and no file", async () => {
      const fake = withDb(() => "saved");
      const { out, io: streams } = io();
      expect(await runIngest(["--in", "c/fhir", "--to-db"], streams, fake.deps)).toBe(0);
      expect(fake.written.size).toBe(0);
      expect(fake.saved.map((row) => row.subjectRef)).toEqual([REF, OTHER]);
      const report = releasedReport(REF, "synthea-v4-seed4242", catalog());
      expect(fake.saved[0]).toEqual(syntheticRow(report));
      expect(fake.saved[0]?.arkBuild).toBe("GRCh38");
      expect(fake.saved[0]?.rows[0]).toEqual({
        rsid: "rs4244285",
        chromosome: "chr10",
        position: 94781859,
        reference: "G",
        genotype: "G/A",
      });
      expect(out.join("")).toContain(
        "Cohort synthea-v4-seed4242: 2 saved, 0 not in the warehouse, 0 refused",
      );
    });

    test("a subject that is not a synthetic member of the cohort fails the run", async () => {
      const fake = withDb((row) =>
        row.subjectRef === REF ? "not_synthetic" : "no_subject",
      );
      const { out, io: streams } = io();
      expect(await runIngest(["--in", "c/fhir", "--to-db"], streams, fake.deps)).toBe(1);
      expect(out.join("")).toContain("0 saved, 1 not in the warehouse, 1 refused");
    });

    test("needs DATA_MODE=synthetic and a database, and no --out", async () => {
      const personal = withDb(() => "saved", "personal");
      const first = io();
      expect(
        await runIngest(["--in", "c/fhir", "--to-db"], first.io, personal.deps),
      ).toBe(1);
      expect(first.err).toEqual([
        "genome:ingest --to-db runs only with DATA_MODE=synthetic.\n",
      ]);
      expect(personal.saved).toEqual([]);
      const second = io();
      expect(
        await runIngest(["--in", "c/fhir", "--to-db"], second.io, deps(FILES).deps),
      ).toBe(1);
      expect(second.err).toEqual(["--to-db needs a database.\n"]);
      expect(parseIngestArgs(["--in", "x", "--to-db", "--out", "y"])).toBe(
        "--out and --to-db do not go together.",
      );
    });
  });
});

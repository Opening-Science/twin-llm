import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { MAX_FILE_BYTES } from "./limits";
import { parseImport } from "./parse-import";
import { reviewSummary } from "./review-summary";
import { chunkRows, cleanDatasetName, defaultDatasetName, savePlan } from "./save-plan";
import { IMPORT_KINDS, isGenomeImportKind, type ParsedOk } from "./types";

const fixtureBytes = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(join(import.meta.dir, "../../tests/fixtures/personal-import", name)),
  );

const parsedOk = (kind: "fhir" | "lab-csv" | "table", name: string): ParsedOk => {
  const parsed = parseImport(kind, fixtureBytes(name));
  if (!parsed.ok) throw new Error(parsed.refusal.message);
  return parsed;
};

const FILE = { fileName: "made-up.csv", byteSize: 515, sha256: "a".repeat(64) };

describe("reviewSummary", () => {
  test("lab CSV: counts, date range, codes with their units, reasons and preview", () => {
    const review = reviewSummary(parsedOk("lab-csv", "lab-results.csv"), FILE);
    expect(review.rowsToStore).toBe(9);
    expect(review.counts).toEqual({
      observations: 9,
      clinicalRecords: 0,
      tableRows: 0,
      tableColumns: 0,
      variants: 0,
      unmapped: 4,
    });
    expect(review.dateRange).toEqual({
      first: "2024-02-10T00:00:00.000Z",
      last: "2025-05-20T06:30:00.000Z",
    });
    expect(review.codesTotal).toBe(9);
    expect(review.codes.slice(0, 3)).toEqual([
      {
        system: "http://loinc.org",
        code: "2276-4",
        display: "Ferritin",
        units: ["ng/mL"],
        count: 1,
      },
      {
        system: "http://loinc.org",
        code: "2345-7",
        display: "Glucose",
        units: ["mg/dL"],
        count: 1,
      },
      {
        system: "http://loinc.org",
        code: "4548-4",
        display: "HbA1c",
        units: ["%"],
        count: 1,
      },
    ]);
    expect(review.units.find((unit) => unit.unit === "x10^9/L")).toEqual({
      unit: "x10^9/L",
      ucum: false,
      count: 1,
    });
    expect(review.unmapped.byReason.map((reason) => [reason.code, reason.count])).toEqual(
      [
        ["bad-loinc", 1],
        ["date-no-time-zone", 1],
        ["no-unit", 1],
        ["not-a-number", 1],
      ],
    );
    expect(review.preview.columns).toEqual(["date", "code", "name", "value", "unit"]);
    expect(review.preview.rows.slice(0, 2)).toEqual([
      ["2024-02-10", "4548-4", "HbA1c", 5.4, "%"],
      ["2024-02-10", "2093-3", "Total cholesterol", 182, "mg/dL"],
    ]);
    expect(review.preview.rows[6]).toEqual([
      "2025-05-20T06:30:00.000Z",
      "3016-3",
      "TSH",
      2.1,
      "m[IU]/L",
    ]);
  });

  test("FHIR: conditions counted and their dates in the range", () => {
    const review = reviewSummary(parsedOk("fhir", "fhir-bundle.json"), FILE);
    expect([
      review.rowsToStore,
      review.counts.observations,
      review.counts.clinicalRecords,
    ]).toEqual([5, 4, 1]);
    expect(review.dateRange).toEqual({
      first: "2023-11-02T00:00:00.000Z",
      last: "2025-06-01T09:00:00.000Z",
    });
  });

  test("table: columns, day range from date columns, rows as stored", () => {
    const review = reviewSummary(parsedOk("table", "research-table.tsv"), FILE);
    expect([
      review.rowsToStore,
      review.counts.tableColumns,
      review.counts.unmapped,
    ]).toEqual([4, 5, 1]);
    expect(review.dateRange).toEqual({ first: "2024-01-15", last: "2024-02-01" });
    expect(review.preview.rows[1]).toEqual([
      "p02",
      "2024-01-16",
      null,
      null,
      "second visit",
    ]);
    expect(review.codes).toEqual([]);
  });
});

describe("parseImport", () => {
  test("refuses empty, oversized and non-UTF-8 files before parsing", () => {
    expect(parseImport("table", new Uint8Array())).toEqual({
      ok: false,
      refusal: { code: "empty", message: "The file is empty." },
    });
    expect(parseImport("table", new Uint8Array(MAX_FILE_BYTES + 1))).toEqual({
      ok: false,
      refusal: { code: "too-large", message: "The file is larger than 50 MB." },
    });
    expect(parseImport("lab-csv", new Uint8Array([0x61, 0xff, 0x62]))).toEqual({
      ok: false,
      refusal: { code: "not-utf8", message: "The file is not UTF-8 text." },
    });
  });
});

describe("savePlan", () => {
  const input = {
    userId: "user-1",
    name: "",
    fileName: "folder/My labs.v2.csv",
    sha256: "b".repeat(64),
    byteSize: 515,
  };

  test("lab rows: dataset facts, rows unchanged, no table", () => {
    const parsed = parsedOk("lab-csv", "lab-results.csv");
    const plan = savePlan(parsed, input);
    expect(plan.dataset).toEqual({
      userId: "user-1",
      kind: "lab-csv",
      name: "My labs.v2",
      sourceFileName: "folder/My labs.v2.csv",
      sha256: "b".repeat(64),
      byteSize: 515,
      rowCount: 9,
      firstAt: "2024-02-10T00:00:00.000Z",
      lastAt: "2025-05-20T06:30:00.000Z",
      genomeBuild: null,
    });
    expect(plan.observations).toBe(parsed.kind === "lab-csv" ? parsed.observations : []);
    expect([plan.clinical, plan.table, plan.chunks]).toEqual([[], null, []]);
  });

  test("table rows go in chunks with the columns alongside", () => {
    const plan = savePlan(parsedOk("table", "research-table.tsv"), {
      ...input,
      name: "Visits",
    });
    expect(plan.dataset.name).toBe("Visits");
    expect(plan.table).toEqual({
      columns: [
        { name: "participant", type: "text", missing: 0 },
        { name: "visit_date", type: "date", missing: 1 },
        { name: "score", type: "number", missing: 1 },
        { name: "group", type: "text", missing: 1 },
        { name: "comment", type: "text", missing: 0 },
      ],
      rowCount: 4,
    });
    expect(plan.chunks.length).toBe(1);
    expect(plan.chunks[0]!.length).toBe(4);
  });

  test("chunks of 1,000 rows, in order", () => {
    const rows = Array.from({ length: 2_001 }, (_, index) => index);
    const chunks = chunkRows(rows);
    expect(chunks.map((chunk) => [chunk.length, chunk[0]])).toEqual([
      [1000, 0],
      [1000, 1000],
      [1, 2000],
    ]);
  });

  test("names lose control characters and extra spaces, and keep 120 characters", () => {
    expect(cleanDatasetName("  a\u0000b\n  c\t")).toBe("a b c");
    expect(cleanDatasetName("x".repeat(200)).length).toBe(120);
    expect(defaultDatasetName(".csv")).toBe(".csv");
    expect(defaultDatasetName("")).toBe("Imported data");
  });
});

describe("a genome VCF", () => {
  const VCF = [
    "##fileformat=VCFv4.2",
    "##reference=GRCh38",
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC_1",
    "chr1\t100\trs1\tA\tG\t.\tPASS\t.\tGT\t0/0",
    "chr1\t200\trs2\tC\tT\t.\tPASS\t.\tGT\t0/1",
    "chr2\t300\t.\tG\tA\t.\t.\t.\tGT\t1/1",
    "chr2\t400\trs4\tT\tC\t.\tPASS\t.\tGT\t./.",
    "chr2\t500\trs5\tT\tC\t.\tPASS\t.\tDP\t3",
    "",
  ].join("\n");
  const parsed = parseImport("vcf", new TextEncoder().encode(VCF));
  if (!parsed.ok) throw new Error(parsed.refusal.message);

  test("review: build, genotype counts, chromosomes and the preview as stored", () => {
    const review = reviewSummary(parsed, FILE);
    expect(review.rowsToStore).toBe(4);
    expect(review.counts).toEqual({
      observations: 0,
      clinicalRecords: 0,
      tableRows: 0,
      tableColumns: 0,
      variants: 4,
      unmapped: 1,
    });
    expect(review.dateRange).toBeNull();
    expect(review.genome).toEqual({
      build: "GRCh38",
      buildSource: "file",
      chromosomes: [
        { chrom: "chr1", count: 2 },
        { chrom: "chr2", count: 2 },
      ],
      genotypes: { homRef: 1, het: 1, homAlt: 1, noCall: 1 },
    });
    expect(review.preview).toEqual({
      columns: ["chrom", "pos", "id", "ref", "alt", "genotype", "filter"],
      rows: [
        ["chr1", 100, "rs1", "A", "G", "0/0", "PASS"],
        ["chr1", 200, "rs2", "C", "T", "0/1", "PASS"],
        ["chr2", 300, null, "G", "A", "1/1", null],
        ["chr2", 400, "rs4", "T", "C", "no call", "PASS"],
      ],
    });
    expect(review.codes).toEqual([]);
  });

  test("other formats have no genome summary", () => {
    expect(reviewSummary(parsedOk("lab-csv", "lab-results.csv"), FILE).genome).toBeNull();
  });

  test("save plan: the variants, the build, no observations", () => {
    const plan = savePlan(parsed, {
      userId: "user-1",
      name: "",
      fileName: "synthetic.vcf.gz",
      sha256: "b".repeat(64),
      byteSize: VCF.length,
    });
    expect(plan.dataset).toEqual({
      userId: "user-1",
      kind: "vcf",
      name: "synthetic.vcf",
      sourceFileName: "synthetic.vcf.gz",
      sha256: "b".repeat(64),
      byteSize: VCF.length,
      rowCount: 4,
      firstAt: null,
      lastAt: null,
      genomeBuild: "GRCh38",
    });
    expect([plan.observations, plan.clinical, plan.chunks, plan.table]).toEqual([
      [],
      [],
      [],
      null,
    ]);
    expect(plan.variants.map((row) => [row.pos, row.genotype])).toEqual([
      [100, "0/0"],
      [200, "0/1"],
      [300, "1/1"],
      [400, null],
    ]);
  });

  test("only a VCF is a genome import", () => {
    expect(IMPORT_KINDS.filter(isGenomeImportKind)).toEqual(["vcf"]);
  });
});

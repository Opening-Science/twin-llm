import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { afterAll, describe, expect, test } from "bun:test";

import { decideBuild, normaliseBuild } from "./build";
import { referenceWindows } from "./index";
import { readFastaSpan } from "./read-fasta";
import { buildWindows, reverseComplement } from "./windows";

const FIXTURES = join(import.meta.dir, "fixtures");
const FASTA = readFileSync(join(FIXTURES, "chr10.fa"), "utf8");
/** The fixture's 200 bases, upper case, as a reader should return them. */
const SEQUENCE = FASTA.split("\n").slice(1).join("").toUpperCase();

const gzDir = mkdtempSync(join(tmpdir(), "genome-reference-gz-"));
writeFileSync(join(gzDir, "chr10.fa.gz"), gzipSync(FASTA));
const crlfDir = mkdtempSync(join(tmpdir(), "genome-reference-crlf-"));
writeFileSync(join(crlfDir, "chr10.fa"), FASTA.replace(/\n/g, "\r\n"));
const raggedDir = mkdtempSync(join(tmpdir(), "genome-reference-ragged-"));
writeFileSync(
  join(raggedDir, "chr10.fa"),
  FASTA.replace("AGCCGAACTC\nCTGGCTTTGA\n", "AGCCGAACTCCTGGC\nTTTGA\n"),
);

afterAll(() => {
  for (const dir of [gzDir, crlfDir, raggedDir]) rmSync(dir, { recursive: true });
});

describe("readFastaSpan", () => {
  test("plain FASTA: any span, across line breaks, soft-masked bases kept", async () => {
    expect(
      await readFastaSpan(FIXTURES, { chromosome: "chr10", start: 7, end: 23 }),
    ).toEqual({ ok: true, bases: FASTA.split("\n").slice(1).join("").slice(7, 23) });
  });

  test("gzip FASTA gives the same bases as the plain file", async () => {
    const plain = await readFastaSpan(FIXTURES, {
      chromosome: "chr10",
      start: 55,
      end: 140,
    });
    const gz = await readFastaSpan(gzDir, { chromosome: "chr10", start: 55, end: 140 });
    expect(gz).toEqual(plain);
  });

  test("CRLF line endings read the same", async () => {
    const span = { chromosome: "chr10", start: 0, end: 200 };
    expect(await readFastaSpan(crlfDir, span)).toEqual(
      await readFastaSpan(FIXTURES, span),
    );
  });

  test("a span past the end returns what is there", async () => {
    const read = await readFastaSpan(FIXTURES, {
      chromosome: "chr10",
      start: 190,
      end: 260,
    });
    expect(read).toEqual({ ok: true, bases: "GCTGACATTG" });
  });

  test("non-uniform line widths are refused, not misread", async () => {
    expect(
      await readFastaSpan(raggedDir, { chromosome: "chr10", start: 30, end: 60 }),
    ).toEqual({
      ok: false,
      code: "REFERENCE_UNREADABLE",
      error: "line widths are not uniform; use a plain or gzipped UCSC file",
    });
  });

  test("a missing chromosome file says which", async () => {
    expect(
      await readFastaSpan(FIXTURES, { chromosome: "chr22", start: 0, end: 5 }),
    ).toEqual({
      ok: false,
      code: "REFERENCE_MISSING",
      error: "no chr22.fa or chr22.fa.gz in GENOME_REFERENCE_DIR",
    });
  });

  test("a name that is not a chromosome is refused before any path is built", async () => {
    expect(
      await readFastaSpan(FIXTURES, { chromosome: "../etc/passwd", start: 0, end: 5 }),
    ).toEqual({
      ok: false,
      code: "REFERENCE_UNREADABLE",
      error: "../etc/passwd is not a chromosome name",
    });
  });
});

describe("referenceWindows", () => {
  test("ref and alt windows of flank + allele + flank, upper case", async () => {
    const position = 65;
    const reference = SEQUENCE[position - 1] ?? "";
    const alternate = reference === "A" ? "G" : "A";
    const windows = await referenceWindows(FIXTURES, {
      chromosome: "chr10",
      position,
      reference,
      alternates: [reference, alternate],
      flank: 8,
    });
    expect(windows).toEqual({
      chromosome: "chr10",
      position,
      flank: 8,
      windowStart: 57,
      reference: { allele: reference, sequence: SEQUENCE.slice(56, 73) },
      alternates: [
        {
          allele: alternate,
          sequence: `${SEQUENCE.slice(56, 64)}${alternate}${SEQUENCE.slice(65, 73)}`,
        },
      ],
    });
  });

  test("the default flank is 256, clamped at the chromosome start", async () => {
    const windows = await referenceWindows(FIXTURES, {
      chromosome: "chr10",
      position: 3,
      reference: SEQUENCE[2] ?? "",
      alternates: [],
    });
    if ("code" in windows) throw new Error(windows.error);
    expect(windows.flank).toBe(256);
    expect(windows.windowStart).toBe(1);
    expect(windows.reference.sequence).toBe(SEQUENCE);
  });

  test("a reference allele that does not match GRCh38 is refused", async () => {
    expect(SEQUENCE[64]).toBe("A");
    expect(
      await referenceWindows(FIXTURES, {
        chromosome: "chr10",
        position: 65,
        reference: "C",
        alternates: [],
      }),
    ).toEqual({
      code: "REF_MISMATCH",
      error: "the report's reference allele C does not match GRCh38's A at chr10:65",
    });
  });

  test("a reference on the other strand is named as such", async () => {
    const found = SEQUENCE[64] ?? "";
    const windows = await referenceWindows(FIXTURES, {
      chromosome: "chr10",
      position: 65,
      reference: reverseComplement(found),
      alternates: [],
    });
    expect(windows).toEqual({
      code: "REF_STRAND_MISMATCH",
      error: `the report's reference allele ${reverseComplement(found)} is the reverse complement of GRCh38's ${found}; the call file is on the other strand`,
    });
  });

  test("no reference folder configured", async () => {
    expect(
      await referenceWindows(null, {
        chromosome: "chr10",
        position: 1,
        reference: "A",
        alternates: [],
      }),
    ).toEqual({
      code: "REFERENCE_NOT_CONFIGURED",
      error: "GENOME_REFERENCE_DIR is not set, so there is no public reference to read",
    });
  });
});

describe("buildWindows", () => {
  test("a deletion allele swaps the reference out", () => {
    const windows = buildWindows(
      { chromosome: "chr1", position: 4, reference: "GT", alternates: ["-"], flank: 3 },
      "AACGTCCA",
      0,
    );
    expect(windows).toEqual({
      chromosome: "chr1",
      position: 4,
      flank: 3,
      windowStart: 1,
      reference: { allele: "GT", sequence: "AACGTCCA" },
      alternates: [{ allele: "-", sequence: "AACCCA" }],
    });
  });

  test("a site past the chromosome end is out of range", () => {
    expect(
      buildWindows(
        { chromosome: "chr1", position: 50, reference: "A", alternates: [], flank: 3 },
        "ACGT",
        40,
      ),
    ).toEqual({
      code: "OUT_OF_RANGE",
      error: "chr1:50 is past the end of the reference chromosome",
    });
  });
});

describe("build", () => {
  test("names map onto GRCh38 and GRCh37", () => {
    expect(["hg38", "GRCh38", "GRCh38.p14", "grch38"].map(normaliseBuild)).toEqual([
      "GRCh38",
      "GRCh38",
      "GRCh38",
      "GRCh38",
    ]);
    expect(["hg19", "GRCh37.p13", "b37"].map(normaliseBuild)).toEqual([
      "GRCh37",
      "GRCh37",
      "GRCh37",
    ]);
    expect(normaliseBuild("T2T-CHM13")).toBe(null);
  });

  test("the Ark's GRCh38 is used as is", () => {
    expect(decideBuild({ arkBuild: "hg38", assumeBuild: null })).toEqual({
      ok: true,
      build: "GRCh38",
      source: "ark",
    });
  });

  test("GRCh37 refuses even when the owner assumes GRCh38", () => {
    expect(decideBuild({ arkBuild: "GRCh37", assumeBuild: "GRCh38" })).toEqual({
      ok: false,
      code: "BUILD_MISMATCH",
      error:
        "the report is on GRCh37 and the reference windows are GRCh38, so the positions do not match",
    });
  });

  test("an unknown named build is never overridden", () => {
    expect(decideBuild({ arkBuild: "T2T-CHM13", assumeBuild: "GRCh38" }).ok).toBe(false);
  });

  test("no build from the Ark: only the explicit assumption allows it", () => {
    expect(decideBuild({ arkBuild: null, assumeBuild: null }).ok).toBe(false);
    expect(decideBuild({ arkBuild: null, assumeBuild: "GRCh38" })).toEqual({
      ok: true,
      build: "GRCh38",
      source: "assumed",
    });
  });
});

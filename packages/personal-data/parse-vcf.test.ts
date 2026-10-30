import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { gzipSync } from "fflate";

import { parseCatalog, type Variant } from "@/scripts/genome-synth/catalog";
import { callCounts, genomeFor } from "@/scripts/genome-synth/generate";

import { MAX_VARIANTS, MAX_VCF_TEXT_BYTES } from "./limits";
import { parseImport } from "./parse-import";
import { genotypeClass, parseVcf, parseVcfRecord } from "./parse-vcf";
import type { ParsedImport, VariantDraft } from "./types";
import { buildNamesInLine, decideVcfBuild, VCF_BUILD_REFUSALS } from "./vcf-build";

/**
 * Every VCF here is synthetic: scripts/genome-synth output for a synthetic
 * subject_ref, or a few made-up lines. Never a person's genome.
 */

const catalog = (): readonly Variant[] => {
  const parsed = parseCatalog(
    readFileSync(
      join(import.meta.dir, "../../scripts/genome-synth/variants.tsv"),
      "utf8",
    ),
  );
  if (typeof parsed === "string") throw new Error(parsed);
  return parsed;
};

const SUBJECT = "080b069b-5108-46b6-ecef-6aacd3b9ef3f";
const SYNTH = genomeFor(SUBJECT, catalog());
const TEXT = SYNTH.vcf;
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const NO_ASSUMPTION = { assumeBuild: null } as const;

const variantsOf = (parsed: ParsedImport): readonly VariantDraft[] => {
  if (!parsed.ok || parsed.kind !== "vcf") {
    throw new Error(parsed.ok ? parsed.kind : parsed.refusal.code);
  }
  return parsed.variants;
};

const refusalOf = (parsed: ParsedImport) => (parsed.ok ? null : parsed.refusal);

/** A small made-up GRCh38 VCF with the given data lines. */
const tiny = (records: readonly string[], header: readonly string[] = []): string =>
  [
    "##fileformat=VCFv4.3",
    "##reference=GRCh38",
    ...header,
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC_1",
    ...records,
    "",
  ].join("\n");

describe("parseVcf on genome-synth output", () => {
  test("plain: every catalog site, genotypes as the generator wrote them", () => {
    const parsed = parseVcf(encode(TEXT), NO_ASSUMPTION);
    const variants = variantsOf(parsed);
    expect(variants.length).toBe(SYNTH.calls.length);
    const records = TEXT.split("\n").filter(
      (line) => line !== "" && !line.startsWith("#"),
    );
    expect(variants).toEqual(
      records.map((line) => {
        const [chrom, pos, id, ref, alt, , filter, , , gt] = line.split("\t");
        return {
          chrom: chrom!,
          pos: Number(pos),
          variantId: id!,
          ref: ref!,
          alt: alt!,
          genotype: gt === "./." ? null : gt!,
          filter: filter!,
        };
      }),
    );
    const counts = callCounts(SYNTH.calls);
    const classes = variants.map((row) => genotypeClass(row.genotype));
    expect({
      homRef: classes.filter((c) => c === "hom-ref").length,
      het: classes.filter((c) => c === "het").length,
      homAlt: classes.filter((c) => c === "hom-alt").length,
      noCall: classes.filter((c) => c === "no-call").length,
    }).toEqual({
      homRef: counts.homRef,
      het: counts.het,
      homAlt: counts.homAlt,
      noCall: counts.noCall,
    });
    expect(parsed.ok && parsed.kind === "vcf" ? parsed.buildSource : null).toBe("file");
    expect(parsed.ok ? parsed.unmapped : null).toEqual([]);
    expect(parsed.ok ? parsed.notes[0] : null).toBe(
      "Read as VCF 4.2 on GRCh38, as the file names it.",
    );
  });

  test("gzip and bgzip-style multi-member gzip give the same rows", () => {
    const plain = variantsOf(parseVcf(encode(TEXT), NO_ASSUMPTION));
    expect(variantsOf(parseVcf(gzipSync(encode(TEXT)), NO_ASSUMPTION))).toEqual(plain);
    const half = Math.floor(TEXT.length / 2);
    const first = gzipSync(encode(TEXT.slice(0, half)));
    const second = gzipSync(encode(TEXT.slice(half)));
    const members = new Uint8Array(first.length + second.length);
    members.set(first);
    members.set(second, first.length);
    expect(variantsOf(parseVcf(members, NO_ASSUMPTION))).toEqual(plain);
  });

  test("through parseImport, CRLF line ends read the same", () => {
    const plain = variantsOf(parseVcf(encode(TEXT), NO_ASSUMPTION));
    expect(variantsOf(parseImport("vcf", encode(TEXT.replaceAll("\n", "\r\n"))))).toEqual(
      plain,
    );
  });
});

describe("build", () => {
  const onBuild = (from: RegExp, to: string) => encode(TEXT.replace(from, to));

  test("GRCh37 or hg19 is refused as BUILD_MISMATCH", () => {
    expect(
      refusalOf(
        parseVcf(onBuild(/##reference=GRCh38/, "##reference=GRCh37"), NO_ASSUMPTION),
      ),
    ).toEqual(VCF_BUILD_REFUSALS.mismatch);
    const hg19 = encode(
      TEXT.replace("##reference=GRCh38", "##reference=file:///ref/hg19.fa").replaceAll(
        "assembly=GRCh38",
        "assembly=hg19",
      ),
    );
    expect(refusalOf(parseVcf(hg19, NO_ASSUMPTION))).toEqual({
      code: "BUILD_MISMATCH",
      message:
        "This VCF is on GRCh37 (hg19). Only GRCh38 files are imported, because GRCh37 positions point at different bases.",
    });
  });

  test("another build is refused as BUILD_UNKNOWN, even with an assumption", () => {
    const other = encode(TEXT.replaceAll("assembly=GRCh38", "assembly=NCBI36"));
    expect(refusalOf(parseVcf(other, { assumeBuild: "GRCh38" }))).toEqual({
      code: "BUILD_UNKNOWN",
      message:
        "This VCF names a build other than GRCh38. Only GRCh38 files are imported.",
    });
  });

  test("no build named: refused, unless GENOME_ASSUME_BUILD=GRCh38", () => {
    const unnamed = encode(
      TEXT.replace("##reference=GRCh38\n", "").replaceAll(",assembly=GRCh38", ""),
    );
    expect(refusalOf(parseVcf(unnamed, NO_ASSUMPTION))).toEqual(VCF_BUILD_REFUSALS.none);
    const assumed = parseVcf(unnamed, { assumeBuild: "GRCh38" });
    expect(variantsOf(assumed).length).toBe(SYNTH.calls.length);
    expect(assumed.ok && assumed.kind === "vcf" ? assumed.buildSource : null).toBe(
      "assumed",
    );
  });

  test("names in header lines", () => {
    expect(
      [
        "##reference=GRCh38",
        "##reference=file:///data/GRCh38_full_analysis_set_plus_decoy_hla.fa",
        "##reference=file:///data/hg38.fa.gz",
        "##reference=GRCh38.p14",
        "##reference=file:///data/genome.fa",
        "##contig=<ID=chr1,length=248956422,assembly=GRCh38>",
        '##contig=<ID=1,assembly="b37",length=249250621>',
        "##contig=<ID=chr1,length=248956422>",
        '##INFO=<ID=GENE,Number=1,Type=String,Description="GRCh37 lift">',
      ].map(buildNamesInLine),
    ).toEqual([
      ["GRCh38"],
      ["GRCh38"],
      ["hg38"],
      ["GRCh38.p14"],
      [],
      ["GRCh38"],
      ["b37"],
      [],
      [],
    ]);
  });

  test("decideVcfBuild", () => {
    expect(decideVcfBuild(["GRCh38", "hg38"], null)).toEqual({
      ok: true,
      build: "GRCh38",
      source: "file",
    });
    expect(decideVcfBuild(["GRCh38", "b37"], null)).toEqual({
      ok: false,
      refusal: VCF_BUILD_REFUSALS.mismatch,
    });
    expect(decideVcfBuild([], "GRCh38")).toEqual({
      ok: true,
      build: "GRCh38",
      source: "assumed",
    });
    expect(decideVcfBuild([], null)).toEqual({
      ok: false,
      refusal: VCF_BUILD_REFUSALS.none,
    });
  });
});

describe("malformed lines are reported, never stored", () => {
  test("each reason once, with its first line and count", () => {
    const parsed = parseVcf(
      encode(
        tiny([
          "chr1\t100\trs1\tA\tG\t.\tPASS\t.\tGT\t0/1",
          "chr1\t101\trs2\tA\tG\t.\tPASS\t.\tGT",
          "chr1\tabc\trs3\tA\tG\t.\tPASS\t.\tGT\t0/1",
          "chr1\t0\trs4\tA\tG\t.\tPASS\t.\tGT\t0/1",
          "chr1\t102\trs5\tAZ\tG\t.\tPASS\t.\tGT\t0/1",
          "chr1\t103\t.\tA\t<DEL>\t.\tPASS\t.\tGT\t0/1",
          "chr1\t104\t.\tA\t.\t.\tPASS\t.\tGT\t0/0",
          "chr1\t105\t.\tA\t<NON_REF>\t.\t.\t.\tGT\t0/0",
          "chr1\t106\trs6\tA\tG\t.\tPASS\t.\tDP\t12",
          "chr1\t107\trs7\tA\tG\t.\tPASS\t.\tGT\t0/x",
          "chr1\t108\trs8\tA\tG\t.\tPASS\t.\tGT\t0/2",
          "chr1\t109\t.\tA\tG,<NON_REF>\t.\t.\t.\tGT:DP\t1|0:9",
          "chr1\t110\t.\tAT\tA,*\t.\tLowQual\t.\tGT\t1/2",
          "chr1\t111\trs9\tC\tT\t.\tPASS\t.\tGT\t./.",
        ]),
      ),
      NO_ASSUMPTION,
    );
    expect(variantsOf(parsed)).toEqual([
      {
        chrom: "chr1",
        pos: 100,
        variantId: "rs1",
        ref: "A",
        alt: "G",
        genotype: "0/1",
        filter: "PASS",
      },
      {
        chrom: "chr1",
        pos: 109,
        variantId: null,
        ref: "A",
        alt: "G",
        genotype: "1|0",
        filter: null,
      },
      {
        chrom: "chr1",
        pos: 110,
        variantId: null,
        ref: "AT",
        alt: "A,*",
        genotype: "1/2",
        filter: "LowQual",
      },
      {
        chrom: "chr1",
        pos: 111,
        variantId: "rs9",
        ref: "C",
        alt: "T",
        genotype: null,
        filter: "PASS",
      },
    ]);
    expect(parsed.ok ? parsed.unmapped : null).toEqual([
      {
        where: "line 5",
        code: "wrong-columns",
        reason: "has 9 columns; a one-sample VCF has 10",
        count: 1,
      },
      {
        where: "line 6",
        code: "bad-position",
        reason: "has a position that is not a whole number above 0",
        count: 2,
      },
      {
        where: "line 8",
        code: "bad-ref",
        reason: "has a reference allele that is not A, C, G, T or N",
        count: 1,
      },
      {
        where: "line 9",
        code: "symbolic-allele",
        reason:
          "has a symbolic or breakend allele (such as <DEL>), which this import does not read",
        count: 1,
      },
      {
        where: "line 10",
        code: "reference-only",
        reason: "is a reference-only record with no alternate allele",
        count: 2,
      },
      { where: "line 12", code: "no-genotype", reason: "has no GT field", count: 1 },
      {
        where: "line 13",
        code: "bad-genotype",
        reason: "has a GT that is not a genotype",
        count: 2,
      },
    ]);
  });

  test("parseVcfRecord and genotypeClass", () => {
    expect(parseVcfRecord("chrX\t5\trs1\tG\tA\t50\tPASS\tDP=3\tGT:GQ\t1:99")).toEqual({
      ok: true,
      variant: {
        chrom: "chrX",
        pos: 5,
        variantId: "rs1",
        ref: "G",
        alt: "A",
        genotype: "1",
        filter: "PASS",
      },
    });
    expect(parseVcfRecord("chr1\t2147483648\t.\tA\tG\t.\t.\t.\tGT\t0/1")).toEqual({
      ok: false,
      code: "bad-position",
      reason: "has a position that is not a whole number above 0",
    });
    expect(
      ["0/0", "0|1", "1/2", "1/1", "1", "./.", "./1", null].map(genotypeClass),
    ).toEqual([
      "hom-ref",
      "het",
      "het",
      "hom-alt",
      "hom-alt",
      "no-call",
      "no-call",
      "no-call",
    ]);
  });
});

describe("refused files", () => {
  const code = (text: string | Uint8Array) =>
    refusalOf(parseVcf(typeof text === "string" ? encode(text) : text, NO_ASSUMPTION));

  test("not a VCF, or not VCF 4.x", () => {
    expect(code("date,test\n")).toEqual({
      code: "not-vcf",
      message: "This is not a VCF: the first line is not ##fileformat=VCFv4.x.",
    });
    expect(code(tiny([]).replace("VCFv4.3", "VCFv3.3"))).toEqual({
      code: "vcf-version",
      message: "Only VCF 4.x is imported; this file is VCF 3.3.",
    });
    expect(code("##fileformat=VCFv4.2\n##reference=GRCh38\n")).toEqual({
      code: "not-vcf",
      message: "This VCF has no #CHROM header line.",
    });
    expect(code("##fileformat=VCFv4.2\nchr1\t1\t.\tA\tG\t.\t.\t.\tGT\t0/1\n")).toEqual({
      code: "not-vcf",
      message: "The file has records before its #CHROM header line.",
    });
  });

  test("no sample, or several", () => {
    expect(code(tiny([]).replace("\tFORMAT\tSYNTHETIC_1", ""))?.code).toBe("no-sample");
    expect(code(tiny([]).replace("SYNTHETIC_1", "SYNTHETIC_1\tSYNTHETIC_2"))).toEqual({
      code: "several-samples",
      message: "This VCF holds 2 samples. Import a VCF with one person's sample.",
    });
  });

  test("not UTF-8, broken or cut-off gzip", () => {
    expect(code(new Uint8Array([0x23, 0x23, 0xff, 0xfe, 0x0a]))?.code).toBe("not-utf8");
    expect(code(new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03]))).toEqual({
      code: "gzip-unreadable",
      message: "The gzip file could not be read.",
    });
    const gz = gzipSync(encode(TEXT));
    expect(code(gz.subarray(0, gz.length - 12))?.code).toBe("gzip-unreadable");
  });

  test("size caps: more records or more text than allowed is refused, not cut", () => {
    expect(MAX_VARIANTS).toBe(200_000);
    expect(MAX_VCF_TEXT_BYTES).toBe(500_000_000);
    const many = tiny([
      "chr1\t1\t.\tA\tG\t.\t.\t.\tGT\t0/1",
      "chr1\t2\t.\tA\tG\t.\t.\t.\tGT\t0/1",
      "chr1\t3\t.\tA\tG\t.\t.\t.\tGT\t0/1",
    ]);
    expect(
      refusalOf(parseVcf(encode(many), { assumeBuild: null, maxVariants: 2 })),
    ).toEqual({
      code: "too-many-variants",
      message: "The VCF has more than 2 variant records; the limit is 2.",
    });
    expect(
      variantsOf(parseVcf(encode(many), { assumeBuild: null, maxVariants: 3 })).length,
    ).toBe(3);
    expect(
      refusalOf(
        parseVcf(gzipSync(encode(TEXT)), { assumeBuild: null, maxTextBytes: 1_000 }),
      ),
    ).toEqual({
      code: "too-large",
      message: "The VCF's text is longer than 0.001 MB, the limit for one import.",
    });
  });

  test("the default cap: one record over 200,000 is refused", () => {
    const records = Array.from(
      { length: MAX_VARIANTS + 1 },
      (_, index) => `chr1\t${index + 1}\t.\tA\tG\t.\t.\t.\tGT\t0/1`,
    );
    expect(
      refusalOf(parseVcf(gzipSync(encode(tiny(records))), NO_ASSUMPTION))?.code,
    ).toBe("too-many-variants");
  });
});

import { describe, expect, test } from "bun:test";

import {
  canonicalChrom,
  chromSpellings,
  genotypeBases,
  parseVariantName,
  parseVariantNames,
  recordIds,
  recordMatches,
  type VariantRecord,
} from "./imported-variant-names";

/** Made-up records; never a person's genome. */
const record = (overrides: Partial<VariantRecord> = {}): VariantRecord => ({
  chrom: "chr1",
  pos: 1000,
  variantId: "rs1000",
  ref: "C",
  alt: "T",
  genotype: "0/1",
  filter: "PASS",
  ...overrides,
});

describe("parseVariantName", () => {
  test("an rsID", () => {
    expect(parseVariantName("rs4244285")).toEqual({
      kind: "rsid",
      name: "rs4244285",
      rsid: "rs4244285",
    });
  });

  test("a site, with chr and the chromosome read as 1 to 22, X, Y or M", () => {
    expect(parseVariantName("chr10:94781859")).toEqual({
      kind: "site",
      name: "chr10:94781859",
      chrom: "10",
      pos: 94781859,
    });
    expect(parseVariantName("chrX:5")).toEqual({
      kind: "site",
      name: "chrX:5",
      chrom: "X",
      pos: 5,
    });
    expect(parseVariantName("chrMT:73")).toEqual({
      kind: "site",
      name: "chrMT:73",
      chrom: "M",
      pos: 73,
    });
  });

  test("ranges, genes, bare chromosomes and wildcards are not names", () => {
    expect(
      [
        "chr1:100-200",
        "chr1",
        "CYP2C19",
        "*",
        "rs0",
        "RS123",
        "10:94781859",
        "chr23:1",
        "chr1:0",
        "chr1:2147483648",
        "rs1 ",
        "",
      ].map(parseVariantName),
    ).toEqual(Array.from({ length: 12 }, () => null));
  });
});

describe("parseVariantNames", () => {
  test("keeps each name once, in order, and lists the unreadable ones", () => {
    expect(parseVariantNames(["rs2", "chr1:5", "rs2", "chr1:5-9", "gene"])).toEqual({
      names: [
        { kind: "rsid", name: "rs2", rsid: "rs2" },
        { kind: "site", name: "chr1:5", chrom: "1", pos: 5 },
      ],
      malformed: ["chr1:5-9", "gene"],
    });
  });
});

describe("chromosome spellings", () => {
  test("canonicalChrom drops chr and reads MT as M", () => {
    expect(["chr1", "1", "chrX", "x", "chrMT", "MT", "chrM"].map(canonicalChrom)).toEqual(
      ["1", "1", "X", "X", "M", "M", "M"],
    );
  });

  test("chromSpellings lists what a file may write", () => {
    expect(chromSpellings("10")).toEqual(["chr10", "10"]);
    expect(chromSpellings("M")).toEqual(["chrM", "chrMT", "M", "MT"]);
  });
});

describe("recordIds and recordMatches", () => {
  test("splits an ID cell on ;", () => {
    expect(recordIds("rs1;rs22")).toEqual(["rs1", "rs22"]);
    expect(recordIds(null)).toEqual([]);
  });

  test("an rsID matches a whole ID, never a prefix of one", () => {
    const rs1 = parseVariantName("rs1");
    if (rs1 === null) throw new Error("rs1");
    expect(recordMatches(rs1, record({ variantId: "rs1;rs22" }))).toBe(true);
    expect(recordMatches(rs1, record({ variantId: "rs12" }))).toBe(false);
    expect(recordMatches(rs1, record({ variantId: null }))).toBe(false);
  });

  test("a site matches either chromosome spelling at that position only", () => {
    const site = parseVariantName("chr1:1000");
    if (site === null) throw new Error("site");
    expect(recordMatches(site, record({ chrom: "1" }))).toBe(true);
    expect(recordMatches(site, record({ chrom: "chr1" }))).toBe(true);
    expect(recordMatches(site, record({ pos: 1001 }))).toBe(false);
    expect(recordMatches(site, record({ chrom: "chr11" }))).toBe(false);
  });
});

describe("genotypeBases", () => {
  test("spells GT in bases and keeps phasing", () => {
    expect(genotypeBases(record())).toBe("C/T");
    expect(genotypeBases(record({ genotype: "1|1" }))).toBe("T|T");
    expect(genotypeBases(record({ alt: "T,G", genotype: "1/2" }))).toBe("T/G");
    expect(genotypeBases(record({ genotype: "1" }))).toBe("T");
  });

  test("a no-call or an allele the record does not list is null", () => {
    expect(genotypeBases(record({ genotype: null }))).toBeNull();
    expect(genotypeBases(record({ genotype: "./1" }))).toBeNull();
    expect(genotypeBases(record({ genotype: "0/2" }))).toBeNull();
  });
});

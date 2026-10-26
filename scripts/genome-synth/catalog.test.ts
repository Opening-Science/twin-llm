import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ARK_PANEL } from "./ark-report";
import {
  byPosition,
  CATALOG_COLUMNS,
  parseCatalog,
  renderCatalog,
  type Variant,
} from "./catalog";

const text = readFileSync(join(import.meta.dir, "variants.tsv"), "utf8");

const catalog = (): readonly Variant[] => {
  const parsed = parseCatalog(text);
  if (typeof parsed === "string") throw new Error(parsed);
  return parsed;
};

const HEADER = CATALOG_COLUMNS.join("\t");
const ROW =
  "rs4244285\tpanel\tCYP2C19\tchr10\t94781859\tG\tA\t0.1679\tgnomADg:ALL\tsynonymous_variant\tdrug response\tnote";

describe("variants.tsv", () => {
  test("parses, and holds the eleven panel sites plus 81 curated ones", () => {
    const variants = catalog();
    expect(variants.length).toBe(92);
    expect(variants.filter((v) => v.category === "panel").map((v) => v.rsid)).toEqual([
      ...ARK_PANEL,
    ]);
    const counts = Object.fromEntries(
      [...Map.groupBy(variants, (v) => v.category)].map(([key, list]) => [
        key,
        list.length,
      ]),
    );
    expect(counts).toEqual({
      panel: 11,
      pgx: 37,
      clinvar_pathogenic: 13,
      clinvar_benign: 10,
      trait: 21,
    });
  });

  test("names its sources and licences in the header", () => {
    const header = text
      .split("\n")
      .filter((line) => line.startsWith("#"))
      .join("\n");
    for (const needle of [
      "SYNTHETIC USE ONLY",
      "Ensembl",
      "dbSNP",
      "gnomAD: CC0 1.0",
      "ClinVar",
      "CPIC",
      "1000 Genomes",
    ]) {
      expect(header).toContain(needle);
    }
  });

  test("keeps the CPIC panel sites at their GRCh38 positions and forward-strand alleles", () => {
    const at = (rsid: string) => {
      const found = catalog().find((v) => v.rsid === rsid);
      return found && [found.chrom, found.pos, found.ref, found.alt];
    };
    expect(at("rs4244285")).toEqual(["chr10", 94781859, "G", "A"]);
    expect(at("rs4986893")).toEqual(["chr10", 94780653, "G", "A"]);
    expect(at("rs3918290")).toEqual(["chr1", 97450058, "C", "T"]);
    expect(at("rs1142345")).toEqual(["chr6", 18130687, "T", "C"]);
    expect(at("rs9923231")).toEqual(["chr16", 31096368, "C", "T"]);
  });

  test("render gives the file back byte for byte", () => {
    const header = text.split("\n").filter((line) => line.startsWith("#"));
    expect(renderCatalog(header, catalog())).toBe(text);
  });
});

describe("parseCatalog", () => {
  test("reads one row", () => {
    expect(parseCatalog(`# c\n${HEADER}\n${ROW}\n`)).toEqual([
      {
        rsid: "rs4244285",
        category: "panel",
        gene: "CYP2C19",
        chrom: "chr10",
        pos: 94781859,
        ref: "G",
        alt: "A",
        altAf: 0.1679,
        afSource: "gnomADg:ALL",
        consequence: "synonymous_variant",
        clinvar: "drug response",
        note: "note",
      },
    ]);
  });

  test("names the first bad line", () => {
    const swap = (index: number, value: string) => {
      const cells = ROW.split("\t");
      cells[index] = value;
      return `${HEADER}\n${cells.join("\t")}\n`;
    };
    expect(parseCatalog("rsid\n")).toBe("variants.tsv: unexpected header");
    expect(parseCatalog(swap(0, "4244285"))).toBe("variants.tsv data line 1: bad rsid");
    expect(parseCatalog(swap(1, "risk"))).toBe("variants.tsv data line 1: bad category");
    expect(parseCatalog(swap(3, "chrX"))).toBe(
      "variants.tsv data line 1: not an autosome",
    );
    expect(parseCatalog(swap(4, "0"))).toBe("variants.tsv data line 1: bad position");
    expect(parseCatalog(swap(6, "G"))).toBe("variants.tsv data line 1: bad alleles");
    expect(parseCatalog(swap(6, "AT"))).toBe("variants.tsv data line 1: bad alleles");
    expect(parseCatalog(swap(7, "0"))).toBe(
      "variants.tsv data line 1: bad allele frequency",
    );
    expect(parseCatalog(swap(2, ""))).toBe(
      "variants.tsv data line 1: empty gene, source or consequence",
    );
    expect(parseCatalog(`${HEADER}\nrs1\tpanel\n`)).toBe(
      "variants.tsv data line 1: wrong column count",
    );
    expect(parseCatalog(`${HEADER}\n${ROW}\n${ROW}\n`)).toBe(
      "variants.tsv: an rsid is listed twice",
    );
  });

  test("byPosition sorts by chromosome number, then position", () => {
    const sorted = byPosition(catalog());
    expect(sorted.slice(0, 2).map((v) => v.rsid)).toEqual(["rs1801131", "rs1801133"]);
    expect(sorted.at(-1)?.rsid).toBe("rs1065852");
    expect(sorted.map((v) => v.chrom).indexOf("chr2")).toBeGreaterThan(
      sorted.map((v) => v.chrom).lastIndexOf("chr1"),
    );
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  ensemblCitation,
  geneLookupUrl,
  parseGene,
  parseVariant,
  variantLookupUrl,
} from "./ensembl";

/** Recorded from rest.ensembl.org on 2026-10-31 (KCNH2, rs429358). */
const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

describe("Ensembl addresses", () => {
  test("gene by symbol and variant by rsID, JSON only", () => {
    expect(geneLookupUrl("KCNH2")).toBe(
      "https://rest.ensembl.org/lookup/symbol/homo_sapiens/KCNH2?content-type=application/json",
    );
    expect(variantLookupUrl("rs429358")).toBe(
      "https://rest.ensembl.org/variation/homo_sapiens/rs429358?content-type=application/json",
    );
  });
});

describe("parsing recorded responses", () => {
  test("a gene", () => {
    const gene = parseGene(fixture("ensembl-gene-KCNH2.json"));
    expect(gene).toEqual({
      kind: "gene",
      id: "ENSG00000055118",
      symbol: "KCNH2",
      description: "potassium voltage-gated channel subfamily H member 2",
      biotype: "protein_coding",
      location: "7:150944064-150978394",
      strand: -1,
      assembly: "GRCh38",
      url: "https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=ENSG00000055118",
    });
    expect(ensemblCitation(gene)).toEqual({
      source: "Ensembl",
      id: "ENSG00000055118",
      title: "KCNH2 gene (Ensembl ENSG00000055118)",
      url: "https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=ENSG00000055118",
    });
  });

  test("a variant; a missing frequency stays missing", () => {
    const variant = parseVariant(fixture("ensembl-variant-rs429358.json"));
    expect(variant).toEqual({
      kind: "variant",
      rsid: "rs429358",
      variantClass: "SNP",
      mostSevereConsequence: "missense_variant",
      minorAllele: null,
      minorAlleleFrequency: null,
      clinicalSignificance: [
        "uncertain significance",
        "not provided",
        "benign",
        "likely pathogenic",
        "pathogenic",
        "drug response",
        "other",
        "risk factor",
        "association",
        "protective",
        "established risk allele",
      ],
      mappings: [
        { location: "19:44908684-44908684", alleles: "T/C", assembly: "GRCh38" },
      ],
      url: "https://www.ensembl.org/Homo_sapiens/Variation/Explore?v=rs429358",
    });
    expect(ensemblCitation(variant).id).toBe("rs429358");
  });

  test("a body without an id throws a code", () => {
    expect(() => parseGene('{"error":"No valid lookup found"}')).toThrow(
      "ENSEMBL_GENE_MALFORMED",
    );
    expect(() => parseVariant("[]")).toThrow("ENSEMBL_VARIANT_MALFORMED");
  });
});

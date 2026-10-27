import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  genotypeAlleles,
  parseRsidGenotypesReport,
  RSID_GENOTYPES_GRANTS,
  RSID_PANEL,
} from "./rsid-genotypes";

const APP_DIR = join(import.meta.dir, "../../apps/ark/rsid-genotypes");
const golden = (name: string): string =>
  readFileSync(join(APP_DIR, "goldens", name), "utf8");

describe("rsid-genotypes panel", () => {
  test("matches the Rust app's panel, in report order", () => {
    const lib = readFileSync(join(APP_DIR, "src/lib.rs"), "utf8");
    const rustPanel = [...lib.matchAll(/rsid: "(rs\d+)",\s*gene: "([A-Z0-9]+)"/g)].map(
      (match) => [match[1], match[2]],
    );
    expect(RSID_PANEL.map((entry) => [entry.rsid, entry.gene])).toEqual(rustPanel);
  });

  test("grants are the manifest dataset paths", () => {
    expect(RSID_GENOTYPES_GRANTS[0]).toBe("v1/genome/rsids/rs4244285");
    expect(RSID_GENOTYPES_GRANTS.length).toBe(11);
  });
});

describe("parseRsidGenotypesReport", () => {
  test("reads the present golden", () => {
    const parsed = parseRsidGenotypesReport(golden("present.tsv"));
    if (!parsed.ok) throw new Error(parsed.issue);
    expect(parsed.rows[0]).toEqual({
      rsid: "rs4244285",
      chromosome: "chr10",
      position: 94781859,
      reference: "G",
      genotype: "A/G",
    });
    expect(parsed.rows.map((row) => row.genotype)).toEqual([
      "A/G",
      "G/G",
      "C/T",
      "C/C",
      "A/C",
      "C/T",
      "G/A",
      "T/C",
      "C/C",
      "A/G",
      "G/A",
    ]);
  });

  test("no call stays null, never a reference fill", () => {
    const parsed = parseRsidGenotypesReport(golden("unanswered.tsv"));
    if (!parsed.ok) throw new Error(parsed.issue);
    expect(parsed.rows.every((row) => row.genotype === null)).toBe(true);
    expect(parsed.rows[10]).toEqual({
      rsid: "rs9923231",
      chromosome: "chr16",
      position: 31096368,
      reference: "G",
      genotype: null,
    });
  });

  test("refuses a report without the footer", () => {
    const text = golden("present.tsv").replace(/Research use only.*\n$/, "\n");
    expect(parseRsidGenotypesReport(text)).toEqual({
      ok: false,
      issue: "missing research-use footer",
    });
  });

  test("refuses rows out of panel order", () => {
    const text = golden("present.tsv").replace("rs4986893", "rs9999999");
    expect(parseRsidGenotypesReport(text)).toEqual({
      ok: false,
      issue: "row 2 is rs9999999, expected rs4986893",
    });
  });

  test("refuses a genotype that is not alleles", () => {
    const text = golden("present.tsv").replace("\tA/G\n", "\tmaybe\n");
    expect(parseRsidGenotypesReport(text)).toEqual({
      ok: false,
      issue: "rs4244285 has an unreadable genotype",
    });
  });

  test("an empty leaf is null", () => {
    const text = golden("present.tsv").replace("chr10\t94781859", "chr10\t");
    const parsed = parseRsidGenotypesReport(text);
    if (!parsed.ok) throw new Error(parsed.issue);
    expect(parsed.rows[0]?.position).toBe(null);
  });
});

describe("genotypeAlleles", () => {
  test("splits phased and unphased calls; no call has none", () => {
    expect(genotypeAlleles("A/G")).toEqual(["A", "G"]);
    expect(genotypeAlleles("C|T")).toEqual(["C", "T"]);
    expect(genotypeAlleles(null)).toEqual([]);
  });
});

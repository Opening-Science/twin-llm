import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  genotypeAlleles,
  parseRsidGenotypesReport,
  RSID_GENOTYPES_GRANTS,
  RSID_GENOTYPES_REQUIRED,
  RSID_GENOTYPES_VERSION,
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
      "T/C",
      "C/T",
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
      reference: "C",
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

  test("ArkOS 0.13 shapes: leading phase, missing, deleted and symbolic copies", () => {
    expect(genotypeAlleles("|A|G")).toEqual(["A", "G"]);
    expect(genotypeAlleles("./.")).toEqual([]);
    expect(genotypeAlleles("A/.")).toEqual(["A"]);
    expect(genotypeAlleles("T/*")).toEqual(["T"]);
    expect(genotypeAlleles("G")).toEqual(["G"]);
    expect(genotypeAlleles("C/<DEL>")).toEqual(["C"]);
  });
});

describe("rsid-genotypes 0.2.0 on ArkOS 0.13", () => {
  test("the version and required grant match the Rust app", () => {
    const lib = readFileSync(join(APP_DIR, "src/lib.rs"), "utf8");
    expect(lib).toContain(`pub const APP_VERSION: &str = "${RSID_GENOTYPES_VERSION}";`);
    expect(lib).toContain(
      `pub const REQUIRED_DATASET: &str = "${RSID_GENOTYPES_REQUIRED}";`,
    );
  });

  test("reads the declined golden: unmounted sites are not granted, ./. is kept", () => {
    const parsed = parseRsidGenotypesReport(golden("declined.tsv"));
    if (!parsed.ok) throw new Error(parsed.issue);
    expect(parsed.rows[4]).toEqual({
      rsid: "rs1057910",
      chromosome: null,
      position: null,
      reference: null,
      genotype: null,
      granted: false,
    });
    expect(parsed.rows[5]?.genotype).toBe("./.");
    expect(
      parsed.rows.filter((row) => row.granted === false).map((row) => row.rsid),
    ).toEqual(["rs1057910", "rs9923231"]);
  });

  test("accepts the documented genotype shapes and refuses a breakend", () => {
    const withCall = (call: string) =>
      parseRsidGenotypesReport(golden("present.tsv").replace("\tA/G\n", `\t${call}\n`));
    for (const call of ["|A|G", "A|G", "G", "./.", ".", "A/.", "T/*", "C/<DEL>"]) {
      const parsed = withCall(call);
      if (!parsed.ok) throw new Error(`${call}: ${parsed.issue}`);
      expect(parsed.rows[0]?.genotype).toBe(call);
    }
    expect(withCall("G/G]chr1:100]")).toEqual({
      ok: false,
      issue: "rs4244285 has an unreadable genotype",
    });
  });

  test("refuses a not granted row that still carries leaves", () => {
    const text = golden("present.tsv").replace("\tA/G\n", "\tnot granted\n");
    expect(parseRsidGenotypesReport(text)).toEqual({
      ok: false,
      issue: "rs4244285 is not granted but has leaves",
    });
  });
});

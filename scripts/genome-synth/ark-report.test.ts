import { describe, expect, test } from "bun:test";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ARK_PANEL,
  FOOTER,
  NO_CALL,
  renderReport,
  type ReportRow,
  reportFor,
  TITLE,
} from "./ark-report";
import { parseCatalog, type Variant } from "./catalog";
import { callsFor } from "./genotypes";

const APP = join(import.meta.dir, "../../apps/ark/rsid-genotypes");

const catalog = (): readonly Variant[] => {
  const parsed = parseCatalog(
    readFileSync(join(import.meta.dir, "variants.tsv"), "utf8"),
  );
  if (typeof parsed === "string") throw new Error(parsed);
  return parsed;
};

/** What the app reads for one site: four leaf files, any of them missing. */
const fixtureRows = (root: string): ReportRow[] =>
  ARK_PANEL.map((rsid) => {
    const leaf = (name: string) => {
      const path = join(root, "v1/genome/rsids", rsid, name);
      return existsSync(path) ? readFileSync(path, "utf8") : null;
    };
    return {
      rsid,
      chromosome: leaf("chromosome") ?? "",
      position: leaf("position") ?? "",
      reference: leaf("reference") ?? "",
      genotype: leaf("genotype"),
    };
  });

describe("Ark rsid-genotypes report", () => {
  test("the panel and strings match the Rust app", () => {
    const source = readFileSync(join(APP, "src/lib.rs"), "utf8");
    const rsids = [...source.matchAll(/rsid: "(rs\d+)"/g)].map((match) => match[1]);
    expect(rsids).toEqual([...ARK_PANEL]);
    expect(source).toContain(`TITLE: &str = "${TITLE}"`);
    expect(source).toContain(`"${FOOTER}"`);
    expect(source).toContain(`NO_CALL: &str = "${NO_CALL}"`);
  });

  test("reproduces the app's goldens from its fixtures", () => {
    for (const name of ["present", "unanswered"]) {
      expect(renderReport(fixtureRows(join(APP, "fixtures", name)))).toBe(
        readFileSync(join(APP, "goldens", `${name}.tsv`), "utf8"),
      );
    }
  });

  test("a synthetic subject's report", () => {
    const variants = catalog();
    const report = reportFor(
      callsFor("080b069b-5108-46b6-ecef-6aacd3b9ef3f", variants),
      variants,
    );
    expect(report).toBe(
      [
        "# rsID genotypes",
        "",
        "rs4244285\tchr10\t94781859\tG\tG/A",
        "rs4986893\tchr10\t94780653\tG\tG/G",
        "rs12248560\tchr10\t94761900\tC\tC/C",
        "rs1799853\tchr10\t94942290\tC\tC/T",
        "rs1057910\tchr10\t94981296\tA\tA/A",
        "rs3892097\tchr22\t42128945\tC\tC/C",
        "rs1065852\tchr22\t42130692\tG\tG/G",
        "rs4149056\tchr12\t21178615\tT\tT/T",
        "rs3918290\tchr1\t97450058\tC\tC/C",
        "rs1142345\tchr6\t18130687\tT\tT/T",
        "rs9923231\tchr16\t31096368\tC\tC/T",
        "",
        "Research use only; genotypes as recorded in the loaded call file.",
        "",
      ].join("\n"),
    );
  });

  test("a site without a call prints no call", () => {
    const variants = catalog();
    const calls = callsFor("080b069b-5108-46b6-ecef-6aacd3b9ef3f", variants).map(
      (call) => (call.variant.rsid === "rs4244285" ? { ...call, altCopies: null } : call),
    );
    expect(reportFor(calls, variants).split("\n")[2]).toBe(
      "rs4244285\tchr10\t94781859\tG\tno call",
    );
    expect(reportFor([], variants).split("\n")[12]).toBe(
      "rs9923231\tchr16\t31096368\tC\tno call",
    );
  });
});

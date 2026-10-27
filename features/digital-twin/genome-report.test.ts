import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GenomeReport } from "./genome-report";
import { type GenomeReportView, isRunPayload, toReportView } from "./genome-report-view";

const REPORT: GenomeReportView = toReportView(
  {
    id: "report-1",
    releasedAt: "2026-10-27T09:00:00.000Z",
    arkBuild: "GRCh38",
    rows: [
      {
        rsid: "rs4244285",
        chromosome: "chr10",
        position: 94781859,
        reference: "G",
        genotype: "A/G",
      },
      {
        rsid: "rs4986893",
        chromosome: "chr10",
        position: 94762706,
        reference: "G",
        genotype: null,
      },
    ],
  },
  null,
);

const render = (preview: Parameters<typeof GenomeReport>[0]["preview"]) =>
  renderToStaticMarkup(createElement(GenomeReport, { preview }));

describe("GenomeReport", () => {
  test("no report yet: a primary Run on Ark button", () => {
    const html = render({ kind: "ready", report: null, error: null });
    expect(html).toContain("Run on Ark");
    expect(html).toContain("No report released yet.");
  });

  test("running: the blocking Approve on your phone state, button disabled", () => {
    const html = render({ kind: "running", report: null });
    expect(html).toContain("Approve on your phone");
    expect(html).toContain('role="status"');
    expect(html).toContain("disabled");
  });

  test("a released report: gene and allele context, genotype or no call", () => {
    const html = render({ kind: "ready", report: REPORT, error: null });
    expect(html).toContain(
      '<td class="py-1.5 pr-3">CYP2C19</td><td class="py-1.5 pr-3">*2</td>',
    );
    expect(html).toContain("chr10:94,781,859");
    expect(html).toContain(">A/G<");
    expect(html).toContain(">no call<");
    expect(html).toContain("Build GRCh38, as the Ark names it");
    expect(html).toContain(
      "Research use only; genotypes as recorded in the loaded call file.",
    );
    expect(html).toContain("Run again");
  });

  test("a failure shows the fixed sentence", () => {
    const html = render({
      kind: "ready",
      report: null,
      error: "The run was declined on your phone. Nothing was released.",
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("declined on your phone");
  });
});

describe("isRunPayload", () => {
  test("accepts a report or a coded failure, nothing else", () => {
    expect(isRunPayload({ ok: true, report: REPORT })).toBe(true);
    expect(isRunPayload({ ok: false, code: "busy", message: "m" })).toBe(true);
    expect(isRunPayload({ ok: false, error: "raw provider text" })).toBe(false);
  });
});

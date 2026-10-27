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
        position: 94780653,
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

  test("running: both phone steps with their windows, button disabled", () => {
    const html = render({ kind: "running", report: null });
    expect(html).toContain("Approve on your phone.");
    expect(html).toContain("within 5 minutes");
    expect(html).toContain("Review and release the report on your phone.");
    expect(html).toContain("within 10 minutes");
    expect(html.indexOf("Approve on your phone")).toBeLessThan(
      html.indexOf("Review and release"),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("disabled");
  });

  test("an unmounted site reads not granted, with the note that says why", () => {
    const declined = toReportView(
      {
        id: "report-2",
        releasedAt: "2026-10-27T09:00:00.000Z",
        arkBuild: "GRCh38",
        rows: [
          {
            rsid: "rs1057910",
            chromosome: null,
            position: null,
            reference: null,
            genotype: null,
            granted: false,
          },
        ],
      },
      null,
    );
    const html = render({ kind: "ready", report: declined, error: null });
    expect(html).toContain(">not granted<");
    expect(html).not.toContain(">no call<");
    expect(html).toContain("The app cannot tell which.");
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
      error: "You declined the run or the report on your phone; nothing was stored.",
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("declined the run or the report on your phone");
    expect(html).not.toContain("The app cannot tell which.");
  });
});

describe("isRunPayload", () => {
  test("accepts a report or a coded failure, nothing else", () => {
    expect(isRunPayload({ ok: true, report: REPORT })).toBe(true);
    expect(isRunPayload({ ok: false, code: "busy", message: "m" })).toBe(true);
    expect(isRunPayload({ ok: false, error: "raw provider text" })).toBe(false);
  });
});

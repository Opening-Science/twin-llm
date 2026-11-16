import { describe, expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";

import { EXPORT_DISCLAIMER } from "./thread-markdown";
import { pdfFileName, threadPdf } from "./thread-pdf";
import {
  layoutPdf,
  type Measure,
  PAGE,
  pdfText,
  spansOf,
  wrapSpans,
} from "./thread-pdf-layout";
import { blocksOf } from "./thread-print";

/** Every character half its size wide. */
const half: Measure = (text, _style, size) => [...text].length * size * 0.5;

const WIDTH = PAGE.width - 2 * PAGE.margin;

describe("characters the standard fonts draw", () => {
  test("Latin-1 and the Windows extras stay; others get stand-ins or ?", () => {
    expect(pdfText("Größe 72.5 µg · café – “ok” …")).toBe(
      "Größe 72.5 µg · café – “ok” …",
    );
    expect(pdfText("SpO₂ ≥ 95 % − 3 → ok")).toBe("SpO2 >= 95 % - 3 -> ok");
    expect(pdfText("Dvořák")).toBe("Dvorák");
    expect(pdfText("心 🫀")).toBe("? ?");
  });
});

describe("inline marks", () => {
  test("bold, italic and code become styles and the marks go", () => {
    expect(spansOf("**Uncertainty.** Few, _see_ `oura.sleep`")).toEqual([
      { text: "Uncertainty.", style: "bold" },
      { text: " Few, ", style: "regular" },
      { text: "see", style: "italic" },
      { text: " ", style: "regular" },
      { text: "oura.sleep", style: "mono" },
    ]);
    expect(spansOf("snake_case_key stays")).toEqual([
      { text: "snake_case_key stays", style: "regular" },
    ]);
  });
});

describe("wrapping", () => {
  test("no line is wider than the width; a long word is cut", () => {
    const lines = wrapSpans(
      spansOf(`${"word ".repeat(40)}${"x".repeat(60)}`),
      100,
      10,
      half,
    );
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) {
      const width = line.reduce((sum, span) => sum + half(span.text, span.style, 10), 0);
      expect(width).toBeLessThanOrEqual(100);
      expect(line[0]?.text.startsWith(" ")).toBe(false);
    }
    expect(
      lines.map((line) => line.map((span) => span.text).join("")).join(""),
    ).toContain("x".repeat(20));
  });
});

describe("pages", () => {
  const long = Array.from(
    { length: 30 },
    (_, index) =>
      `## ${String(index + 1)}. A question\n\n${"A sentence of answer text. ".repeat(12)}`,
  ).join("\n\n");
  const pages = layoutPdf(blocksOf(`# Title\n\n${long}`), "Footer line.", half);

  test("text stays inside the margins and every page has its footer", () => {
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((runs, index) => {
      const body = runs.filter((run) => run.muted !== true);
      for (const run of body) {
        expect(run.y).toBeGreaterThanOrEqual(PAGE.margin);
        expect(run.y).toBeLessThanOrEqual(PAGE.height - PAGE.margin);
        expect(run.x + half(run.text, run.style, run.size)).toBeLessThanOrEqual(
          PAGE.margin + WIDTH + 0.01,
        );
      }
      const footer = runs.filter((run) => run.muted === true).map((run) => run.text);
      expect(footer).toEqual([
        "Footer line.",
        `Page ${String(index + 1)} of ${String(pages.length)}`,
      ]);
    });
  });

  test("a heading never ends a page", () => {
    for (const runs of pages) {
      const body = runs.filter((run) => run.muted !== true);
      expect(body.at(-1)?.size).toBe(10);
    }
  });

  test("a list item has its bullet left of the text", () => {
    const [runs] = layoutPdf(blocksOf("- one\n- two"), "f", half);
    const bullets = (runs ?? []).filter((run) => run.text === "•");
    expect(bullets).toHaveLength(2);
    expect(bullets[0]?.x).toBeLessThan(
      (runs ?? []).find((run) => run.text === "one")?.x ?? 0,
    );
  });
});

describe("the PDF file", () => {
  test("A4 pages, the title, TwinLLM as creator, the export day; no person named", async () => {
    const bytes = await threadPdf(
      "Heart rate",
      "# Heart rate\n\nSpO₂ ≥ 95 %. **Uncertainty.** Few.\n\n- one",
      EXPORT_DISCLAIMER,
      "2026-10-28",
    );
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({ width: PAGE.width, height: PAGE.height });
    expect(doc.getTitle()).toBe("Heart rate");
    expect(doc.getCreator()).toBe("TwinLLM");
    expect(doc.getCreationDate()?.toISOString()).toBe("2026-10-28T00:00:00.000Z");
    expect(doc.getAuthor()).toBeUndefined();
    expect(doc.getSubject()).toBeUndefined();
    expect(doc.getKeywords()).toBeUndefined();
  });

  test("the file name follows the other formats", () => {
    expect(pdfFileName("Heart Rate: spring 2026!")).toBe("heart-rate-spring-2026.pdf");
  });
});

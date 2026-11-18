import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  decodePDFRawStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
} from "pdf-lib";

import { pdfDrawnText } from "@/tests/support/pdf-drawn-text";

import { EXPORT_DISCLAIMER } from "./thread-markdown";
import {
  BRAND_FONTS_DIR,
  brandFold,
  drawnWidth,
  pdfFileName,
  threadPdf,
} from "./thread-pdf";
import {
  layoutPdf,
  type Measure,
  PAGE,
  type PdfPage,
  pdfText,
  spansOf,
  wrapSpans,
} from "./thread-pdf-layout";
import { blocksOf } from "./thread-print";

/** Every character half its size wide. */
const half: Measure = (text, _style, size) => [...text].length * size * 0.5;

const WIDTH = PAGE.width - 2 * PAGE.margin;

/** A folder with no fonts in it: the standard fonts, as in CI. */
const NO_FONTS = join(import.meta.dir, "no-brand-fonts-here");

/** Installed by `bun run fonts:install` on a machine with the licence; never in CI. */
const BRAND_INSTALLED = ["Selecta-Regular.woff2", "Selecta-Medium.woff2"].every((file) =>
  existsSync(join(BRAND_FONTS_DIR, file)),
);

const SPECIAL = "SpO₂ ≥ 95 %, Dvořák, Müller — β-blocker, μmol/L";

const specialPdf = (fontsDir: string) =>
  threadPdf(
    "SpO₂ ≥ 95",
    `# SpO₂ ≥ 95\n\n${SPECIAL}\n\n**${SPECIAL}**\n\n_${SPECIAL}_\n\n\`code β\`\n\n- 心 stays a question mark`,
    EXPORT_DISCLAIMER,
    "2026-10-28",
    fontsDir,
  );

/** BaseFont of every font the pages use, subset prefixes dropped. */
const fontNames = async (bytes: Uint8Array): Promise<string[]> => {
  const doc = await PDFDocument.load(bytes);
  const names = doc.getPages().flatMap((page) => {
    const fonts = page.node.Resources()?.lookup(PDFName.of("Font"), PDFDict);
    return (fonts?.entries() ?? []).map(([, ref]) => {
      const font = doc.context.lookup(ref, PDFDict);
      return (font.get(PDFName.of("BaseFont"))?.toString() ?? "")
        .replace(/^\//, "")
        .replace(/-\d+$/, "");
    });
  });
  return [...new Set(names)].sort();
};

/** How each embedded font program starts: "OTTO" is OpenType, "wOF2" a web font. */
const embeddedFontMagic = async (bytes: Uint8Array): Promise<string[]> => {
  const doc = await PDFDocument.load(bytes);
  return doc.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [
            new TextDecoder("latin1").decode(
              decodePDFRawStream(object).decode().subarray(0, 4),
            ),
          ]
        : [],
    )
    .filter((magic) => magic === "OTTO" || magic === "wOF2");
};

describe("characters the standard fonts draw", () => {
  test("Latin-1 and the Windows extras stay; others get stand-ins or ?", () => {
    expect(pdfText("Größe 72.5 µg · café – “ok” …")).toBe(
      "Größe 72.5 µg · café – “ok” …",
    );
    expect(pdfText("SpO₂ ≥ 95 % − 3 → ok")).toBe("SpO2 >= 95 % - 3 -> ok");
    expect(pdfText("Dvořák")).toBe("Dvorák");
    expect(pdfText("心 🫀")).toBe("? ?");
  });

  test("an exponent stays an exponent", () => {
    expect(pdfText("4.5 × 10⁹/L")).toBe("4.5 × 10^9/L");
    expect(pdfText("10⁻⁶ and 10¹⁰")).toBe("10^-6 and 10^10");
    expect(pdfText("2.1 m²")).toBe("2.1 m²");
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

describe("runs", () => {
  test("a line draws one run per style, words and spaces kept together", () => {
    const [runs] = layoutPdf(
      blocksOf("Plain words **bold words** more plain"),
      "f",
      half,
    );
    expect(
      (runs ?? []).filter((run) => run.muted !== true).map((run) => run.text),
    ).toEqual(["Plain words ", "bold words", " more plain"]);
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

  /** A turn after `filler` lines: its heading, the model's heading, the answer. */
  const turnAfter = (filler: number, prompt: string) =>
    layoutPdf(
      blocksOf(
        `# Title\n\n${"Filler line.\n\n".repeat(filler)}## 1. ${prompt}\n\n### Qwen3 4B\n\nThe answer.\n`,
      ),
      "f",
      half,
    );

  /** Index of the page each run's text is on. */
  const pageOf = (pdf: PdfPage[], text: string) =>
    pdf.findIndex((runs) => runs.some((run) => run.text.includes(text)));

  test("a turn heading moves to the next page with its model heading", () => {
    for (let filler = 0; filler <= 80; filler += 1) {
      const pdf = turnAfter(filler, "How did I sleep?");
      expect(pageOf(pdf, "How did I sleep?")).toBe(pageOf(pdf, "Qwen3 4B"));
      expect(pageOf(pdf, "Qwen3 4B")).toBe(pageOf(pdf, "The answer."));
    }
  });

  test("a heading over several lines is not split across pages", () => {
    const prompt = `${"Long question words ".repeat(8)}end of question?`;
    for (let filler = 0; filler <= 80; filler += 1) {
      const pdf = turnAfter(filler, prompt);
      expect(pageOf(pdf, "1. Long")).toBe(pageOf(pdf, "end of question?"));
      expect(pageOf(pdf, "end of question?")).toBe(pageOf(pdf, "The answer."));
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
      NO_FONTS,
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

  test("runs are measured as drawn, without the kerning pdf-lib's width takes off", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    // Helvetica kerns "Va" and "To"; Tj draws them unkerned.
    expect(drawnWidth(font, "Va To", 10)).toBeCloseTo(
      ["V", "a", " ", "T", "o"].reduce(
        (sum, c) => sum + font.widthOfTextAtSize(c, 10),
        0,
      ),
    );
    expect(drawnWidth(font, "Va To", 10)).toBeGreaterThan(
      font.widthOfTextAtSize("Va To", 10),
    );
  });

  test("without the brand fonts: the standard fonts, nothing embedded, stand-ins", async () => {
    const bytes = await specialPdf(NO_FONTS);
    expect(await fontNames(bytes)).toEqual([
      "Courier",
      "Helvetica",
      "Helvetica-Bold",
      "Helvetica-Oblique",
    ]);
    const text = await pdfDrawnText(bytes);
    expect(text).toContain("SpO2 >= 95 %, Dvorák, Müller — ?-blocker, µmol/L");
  });

  test.skipIf(!BRAND_INSTALLED)(
    "with the brand fonts: Selecta as OpenType, every character as written",
    async () => {
      const bytes = await specialPdf(BRAND_FONTS_DIR);
      const names = await fontNames(bytes);
      expect(names.some((name) => name.includes("Selecta"))).toBe(true);
      expect(names.some((name) => name.startsWith("Helvetica"))).toBe(false);
      expect(names).toContain("Courier");
      const text = await pdfDrawnText(bytes);
      expect(text).toContain("SpO₂ ≥ 95");
      expect(text.split("\n").filter((run) => run === SPECIAL)).toHaveLength(3);
      // Courier has no Greek: β comes from Selecta, the code around it stays mono.
      expect(text).toContain("code \nβ");
      expect(text).toContain("? stays a question mark");
      // Embedded as OpenType, never as the WOFF2 file a PDF reader cannot draw.
      expect(await embeddedFontMagic(bytes)).toEqual(["OTTO", "OTTO"]);
      // Two whole fonts (Regular, Medium) are about 100 kB.
      expect(bytes.length).toBeLessThan(200_000);
    },
  );

  test("the file name follows the other formats", () => {
    expect(pdfFileName("Heart Rate: spring 2026!")).toBe("heart-rate-spring-2026.pdf");
  });
});

describe("characters in the brand fonts", () => {
  const codes = (text: string) =>
    new Set([...text].map((char) => char.codePointAt(0) ?? 0));
  const latin = "abcdeor -<>=?";
  const fold = brandFold({
    regular: codes(`${latin}β≥ř`),
    bold: codes(`${latin}≥`),
    italic: codes(`${latin}β≥ř`),
    mono: codes(latin),
  });

  test("a character the style's font has stays in that style", () => {
    expect(fold("code", "mono")).toEqual([{ text: "code", style: "mono" }]);
  });

  test("one the style lacks comes from the regular font, the rest stays", () => {
    expect(fold("code β", "mono")).toEqual([
      { text: "code ", style: "mono" },
      { text: "β", style: "regular" },
    ]);
    expect(fold("ře", "bold")).toEqual([
      { text: "ř", style: "regular" },
      { text: "e", style: "bold" },
    ]);
  });

  test("one no font has gets the style's stand-in or a question mark", () => {
    expect(fold("≤ 心", "regular")).toEqual([{ text: "<= ?", style: "regular" }]);
  });
});

describe("the build", () => {
  /** The arguments of every `join(…)` in thread-pdf.ts. */
  const joins = [
    ...readFileSync(join(import.meta.dir, "thread-pdf.ts"), "utf8").matchAll(
      /\bjoin\(((?:[^()]|\([^()]*\))*)\)/g,
    ),
  ].map((match) => match[1] ?? "");

  /** `process.cwd()` and string literals only: the bundler can scope those. */
  const STATIC = /^\s*(?:process\.cwd\(\)|"[^"]*")(?:\s*,\s*"[^"]*")*\s*,?\s*$/;

  test("a font path made at run time does not trace the whole project", () => {
    expect(joins.length).toBeGreaterThan(0);
    expect(
      joins.filter(
        (args) => !STATIC.test(args) && !args.includes("turbopackIgnore: true"),
      ),
    ).toEqual([]);
  });
});

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { degrees, PDFDocument, type PDFFont, rgb, StandardFonts } from "pdf-lib";

import { readableTitle } from "@/infrastructure/readable-title";

import { exportSlug } from "./thread-markdown";
import {
  type Fold,
  layoutPdf,
  PAGE,
  pdfText,
  type PdfStyle,
  type Span,
  WIN_ANSI,
} from "./thread-pdf-layout";
import { blocksOf } from "./thread-print";
import { cffWoff2ToOpenType } from "./woff2-cff";

/**
 * A thread export as a PDF file (SPEC 9.4): the same Markdown as the other
 * formats, laid out by `thread-pdf-layout.ts`.
 *
 * With the foundation's fonts installed in `public/fonts/` (`bun run
 * fonts:install`, docs/brand.md) the text is Selecta, emphasis and headings
 * Selecta Medium, so SpO₂, ≥, ř or a Greek letter print as written. Italic
 * is Selecta Italic when installed, else Selecta slanted. Each WOFF2 file is
 * unpacked in memory to the OpenType it holds (`woff2-cff.ts`) and embedded
 * whole: fontkit's subsetter writes CFF fonts no reader can draw, and
 * cannot read Diatype's TrueType outlines from WOFF2 at all. So code stays
 * in the standard Courier, with any character Courier lacks drawn in
 * Selecta. Without the files (CI, a checkout without the licence)
 * everything falls back to the standard PDF fonts, nothing embedded, with
 * stand-ins for what they lack.
 *
 * The file names no person: its metadata is the thread's title, TwinLLM as
 * creator and the export day, with no author, subject or keywords.
 */

export const BRAND_FONTS_DIR = join(process.cwd(), "public", "fonts");

const BRAND_FILES = {
  regular: "Selecta-Regular.woff2",
  emphasis: "Selecta-Medium.woff2",
  italic: "Selecta-Italic.woff2",
} as const;

/** Kerning and ligatures off, so a glyph is drawn for each character as measured. */
const PLAIN = { kern: false, liga: false, clig: false, calt: false } as const;

/** pdf-lib's `ySkew` leans the glyphs; its `xSkew` would tilt the baseline. */
const SLANT = degrees(12);

type Fonts = Readonly<{
  styles: Readonly<Record<PdfStyle, PDFFont>>;
  fold: Fold;
  /** Styles drawn slanted because their font is upright. */
  slanted: ReadonlySet<PdfStyle>;
}>;

/**
 * The width `drawText` draws: glyph by glyph. pdf-lib's own width takes off
 * kerning pairs that its text operators never apply, so a run measured that
 * way is drawn wider than measured and overlaps the run after it.
 */
export const drawnWidth = (font: PDFFont, text: string, size: number): number =>
  [...text].reduce((sum, char) => sum + font.widthOfTextAtSize(char, size), 0);

const readOrNull = (path: string): Promise<Uint8Array | null> =>
  readFile(path).catch(() => null);

const standardFonts = async (doc: PDFDocument): Promise<Fonts> => ({
  styles: {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    mono: await doc.embedFont(StandardFonts.Courier),
  },
  fold: WIN_ANSI,
  slanted: new Set(),
});

const joinSpans = (spans: readonly Span[]): Span[] =>
  spans.reduce<Span[]>((joined, span) => {
    const last = joined.at(-1);
    return last?.style === span.style
      ? [...joined.slice(0, -1), { text: last.text + span.text, style: span.style }]
      : [...joined, span];
  }, []);

/** The code points each style's font can draw. */
export type CharacterSets = Readonly<Record<PdfStyle, ReadonlySet<number>>>;

/**
 * Each character in its style's font; one that font lacks (Courier has no
 * Greek) in the regular font when that has it, else a stand-in or "?".
 */
export const brandFold = (sets: CharacterSets): Fold => {
  const has = (style: PdfStyle) => (char: string) =>
    sets[style].has(char.codePointAt(0) ?? -1);
  return (text, style) =>
    joinSpans(
      [...text.normalize("NFC")].map((char): Span =>
        has(style)(char)
          ? { text: char, style }
          : has("regular")(char)
            ? { text: char, style: "regular" }
            : { text: pdfText(char, has(style)), style },
      ),
    );
};

/** The OpenType inside a CFF WOFF2 file; null when missing or anything else. */
const readOpenType = async (path: string): Promise<Uint8Array | null> => {
  const bytes = await readOrNull(path);
  return bytes === null ? null : cffWoff2ToOpenType(bytes);
};

/** Selecta when Regular and Medium are installed and usable, else null. */
const brandFonts = async (doc: PDFDocument, dir: string): Promise<Fonts | null> => {
  const [regular, emphasis, italic] = await Promise.all(
    // Read at run time, not bundled: without the hint the export route's
    // build trace takes in the whole project.
    [BRAND_FILES.regular, BRAND_FILES.emphasis, BRAND_FILES.italic].map((file) =>
      readOpenType(join(/* turbopackIgnore: true */ dir, file)),
    ),
  );
  if (regular === null || emphasis === null) return null;
  doc.registerFontkit(fontkit);
  // Whole fonts: see the note at the top of this file.
  const embed = (bytes: Uint8Array) =>
    doc.embedFont(bytes, { subset: false, features: PLAIN });
  const body = await embed(regular);
  const styles = {
    regular: body,
    bold: await embed(emphasis),
    italic: italic === null ? body : await embed(italic),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  return {
    styles,
    fold: brandFold({
      regular: new Set(styles.regular.getCharacterSet()),
      bold: new Set(styles.bold.getCharacterSet()),
      italic: new Set(styles.italic.getCharacterSet()),
      mono: new Set(styles.mono.getCharacterSet()),
    }),
    slanted: new Set(italic === null ? ["italic" as const] : []),
  };
};

const INK = rgb(0.07, 0.07, 0.07);
const MUTED = rgb(0.4, 0.4, 0.4);

export const threadPdf = async (
  title: string,
  markdown: string,
  footer: string,
  today: string,
  fontsDir: string = BRAND_FONTS_DIR,
): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const fonts = (await brandFonts(doc, fontsDir)) ?? (await standardFonts(doc));
  const pages = layoutPdf(
    blocksOf(markdown),
    footer,
    (text, style, size) => drawnWidth(fonts.styles[style], text, size),
    fonts.fold,
  );
  for (const runs of pages) {
    const page = doc.addPage([PAGE.width, PAGE.height]);
    for (const run of runs) {
      if (run.text === "") continue;
      page.drawText(run.text, {
        x: run.x,
        y: run.y,
        size: run.size,
        font: fonts.styles[run.style],
        color: run.muted === true ? MUTED : INK,
        ...(fonts.slanted.has(run.style) ? { ySkew: SLANT } : {}),
      });
    }
  }
  const day = new Date(`${today}T00:00:00Z`);
  doc.setTitle(readableTitle(title), { showInWindowTitleBar: true });
  doc.setCreator("TwinLLM");
  doc.setLanguage("en-GB");
  doc.setCreationDate(day);
  doc.setModificationDate(day);
  return doc.save();
};

export const pdfFileName = (title: string): string => `${exportSlug(title)}.pdf`;

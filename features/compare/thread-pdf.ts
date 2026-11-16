import { PDFDocument, type PDFFont, rgb, StandardFonts } from "pdf-lib";

import { readableTitle } from "@/infrastructure/readable-title";

import { exportSlug } from "./thread-markdown";
import { layoutPdf, PAGE, type PdfStyle } from "./thread-pdf-layout";
import { blocksOf } from "./thread-print";

/**
 * A thread export as a PDF file (SPEC 9.4): the same Markdown as the other
 * formats, laid out by `thread-pdf-layout.ts` and drawn in the standard PDF
 * fonts, so nothing is embedded and nothing is fetched. The file names no
 * person: its metadata is the thread's title, TwinLLM as creator and the
 * export day, with no author, subject or keywords.
 */

const INK = rgb(0.07, 0.07, 0.07);
const MUTED = rgb(0.4, 0.4, 0.4);

export const threadPdf = async (
  title: string,
  markdown: string,
  footer: string,
  today: string,
): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const fonts: Readonly<Record<PdfStyle, PDFFont>> = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  const pages = layoutPdf(blocksOf(markdown), footer, (text, style, size) =>
    fonts[style].widthOfTextAtSize(text, size),
  );
  for (const runs of pages) {
    const page = doc.addPage([PAGE.width, PAGE.height]);
    for (const run of runs) {
      if (run.text === "") continue;
      page.drawText(run.text, {
        x: run.x,
        y: run.y,
        size: run.size,
        font: fonts[run.style],
        color: run.muted === true ? MUTED : INK,
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

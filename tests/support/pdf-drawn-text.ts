import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
} from "pdf-lib";

/**
 * The text a PDF draws, read back from its pages' text operators, one text
 * run per line. An embedded font's glyph codes are read through its
 * ToUnicode map; a standard font's bytes as Windows-1252. For tests only:
 * it reads what `threadPdf` writes, not every PDF.
 */

const latin1 = new TextDecoder("latin1");
const cp1252 = new TextDecoder("windows-1252");

const streamText = (stream: unknown): string =>
  stream instanceof PDFRawStream
    ? latin1.decode(decodePDFRawStream(stream).decode())
    : "";

const hexToText = (hex: string): string =>
  String.fromCodePoint(
    ...(hex.match(/.{4}/g) ?? []).map((unit) => Number.parseInt(unit, 16)),
  );

/** ToUnicode `bfchar` and `bfrange` entries as code → text. */
const toUnicode = (cmap: string): ReadonlyMap<string, string> => {
  const map = new Map<string, string>();
  for (const [, body] of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, code, text] of (body ?? "").matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g,
    )) {
      map.set((code ?? "").toUpperCase(), hexToText(text ?? ""));
    }
  }
  for (const [, body] of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, from, to, start] of (body ?? "").matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g,
    )) {
      const first = Number.parseInt(from ?? "0", 16);
      const base = Number.parseInt(start ?? "0", 16);
      for (let code = first; code <= Number.parseInt(to ?? "0", 16); code += 1) {
        const key = code
          .toString(16)
          .toUpperCase()
          .padStart(from?.length ?? 4, "0");
        map.set(key, String.fromCodePoint(base + code - first));
      }
    }
  }
  return map;
};

type Decode = (hex: string) => string;

const decoderOf = (doc: PDFDocument, font: unknown): Decode => {
  const dict = font instanceof PDFRef ? doc.context.lookup(font) : font;
  const cmap = dict instanceof PDFDict ? dict.lookup(PDFName.of("ToUnicode")) : undefined;
  if (cmap === undefined) return (hex) => cp1252.decode(Buffer.from(hex, "hex"));
  const map = toUnicode(streamText(cmap));
  return (hex) =>
    (hex.toUpperCase().match(/.{4}/g) ?? []).map((code) => map.get(code) ?? "�").join("");
};

export const pdfDrawnText = async (bytes: Uint8Array): Promise<string> => {
  const doc = await PDFDocument.load(bytes);
  return doc
    .getPages()
    .flatMap((page) => {
      const fonts = page.node.Resources()?.lookup(PDFName.of("Font"), PDFDict);
      const decoders = new Map<string, Decode>(
        (fonts?.entries() ?? []).map(([name, ref]) => [
          name.asString().slice(1),
          decoderOf(doc, ref),
        ]),
      );
      const contents = page.node.Contents();
      const streams =
        contents instanceof PDFArray
          ? contents.asArray().map((ref) => doc.context.lookup(ref))
          : [contents];
      let decode: Decode = () => "";
      return streams.flatMap((stream) =>
        [
          ...streamText(stream).matchAll(/\/(\S+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]*)>\s*Tj/g),
        ].flatMap(([, font, hex]) => {
          if (font !== undefined) {
            decode = decoders.get(font) ?? decode;
            return [];
          }
          return [decode(hex ?? "")];
        }),
      );
    })
    .join("\n");
};

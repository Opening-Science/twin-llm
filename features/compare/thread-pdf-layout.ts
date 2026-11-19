import type { Block } from "./thread-print";

/**
 * Where every word of a thread export sits on A4 pages (SPEC 9.4), as data.
 * Pure: it is handed a width measure, so the PDF writer measures with its
 * fonts and the tests with a fixed one. Inline marks (`**bold**`, `_em_`,
 * `` `code` ``) become styles; the marks themselves are never printed.
 * Text is folded into the characters each style's font can draw.
 */

export type PdfStyle = "regular" | "bold" | "italic" | "mono";

export type PdfRun = Readonly<{
  x: number;
  y: number;
  size: number;
  style: PdfStyle;
  text: string;
  /** Footer and notes print grey. */
  muted?: true;
}>;

export type PdfPage = readonly PdfRun[];

export type Measure = (text: string, style: PdfStyle, size: number) => number;

/**
 * Text in a style as spans its fonts can draw. A character the style's font
 * lacks may come back in another style whose font has it.
 */
export type Fold = (text: string, style: PdfStyle) => Span[];

/** A4 in points, with 18 mm margins like the print page. */
export const PAGE = { width: 595.28, height: 841.89, margin: 51 } as const;

const BODY = 10;
const FOOTER = 7.5;
const LEADING = 1.4;
const LIST_INDENT = 14;
const HEADING: Readonly<Record<number, Readonly<{ size: number; before: number }>>> = {
  1: { size: 16, before: 0 },
  2: { size: 12.5, before: 16 },
  3: { size: 11, before: 10 },
  4: { size: 10, before: 8 },
};

// --- characters -------------------------------------------------------------

/** Windows-1252 beyond Latin-1: what the standard fonts draw in 0x80–0x9F. */
const CP1252_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

/** What the standard PDF fonts draw: Windows-1252. */
export const winAnsiDrawable = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0xa0 && code <= 0xff) ||
    CP1252_EXTRA.includes(char)
  );
};

/** Readable stand-ins for characters the standard fonts lack. */
const STAND_INS: Readonly<Record<string, string>> = {
  // Greek mu as the Latin-1 micro sign, so μmol/L keeps its unit.
  μ: "µ",
  "≥": ">=",
  "≤": "<=",
  "≈": "~",
  "≠": "!=",
  "−": "-",
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "→": "->",
  "←": "<-",
  "↑": "up",
  "↓": "down",
  " ": " ",
  " ": " ",
  " ": " ",
  "​": "",
  "\t": " ",
  "₀": "0",
  "₁": "1",
  "₂": "2",
  "₃": "3",
  "₄": "4",
  "₅": "5",
  "₆": "6",
  "₇": "7",
  "₈": "8",
  "₉": "9",
};

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁺": "+",
  "⁻": "-",
};

/**
 * A raised run the fonts cannot draw whole becomes "^" and its digits, so an
 * exponent stays an exponent: "10⁹/L" is "10^9/L", not "109/L". A run of
 * only ¹ ² ³ is Latin-1 and stays as it is.
 */
const exponents = (text: string, drawable: (char: string) => boolean): string =>
  text.replace(/[⁰¹²³⁴-⁹⁺⁻]+/g, (run) =>
    [...run].every(drawable)
      ? run
      : `^${[...run].map((char) => SUPERSCRIPT[char] ?? char).join("")}`,
  );

/**
 * Text a font can draw: exponents and stand-ins first, then accents dropped
 * (č → c), then "?" for anything left. By default the standard fonts'
 * characters, Windows-1252.
 */
export const pdfText = (
  text: string,
  drawable: (char: string) => boolean = winAnsiDrawable,
): string =>
  [...exponents(text.normalize("NFC"), drawable)]
    .map((char) => {
      if (drawable(char)) return char;
      const stand = STAND_INS[char];
      if (stand !== undefined && [...stand].every(drawable)) return stand;
      const bare = char.normalize("NFD").replace(/\p{M}/gu, "");
      return [...bare].every(drawable) && bare !== "" ? bare : "?";
    })
    .join("");

/** Every style in the standard fonts. */
export const WIN_ANSI: Fold = (text, style) => [{ text: pdfText(text), style }];

// --- inline marks -----------------------------------------------------------

export type Span = Readonly<{ text: string; style: PdfStyle }>;

/** Same marks, same boundaries as the print page's `inline`. */
const MARK =
  /`([^`]+)`|\*\*([^*]+)\*\*|(^|[\s(])_([^_]+)_(?=$|[\s).,;:!?])|(^|[\s(])\*([^*]+)\*(?=$|[\s).,;:!?])/g;

/**
 * Marks inside bold and italic are read too, as the print page nests
 * `<code>` in `<strong>`: "**Take `x` daily**" is bold, then code, then bold.
 */
const marksOf = (line: string, base: PdfStyle): Span[] => {
  const spans: Span[] = [];
  let at = 0;
  const push = (text: string, style: PdfStyle) => {
    if (text !== "") spans.push({ text, style });
  };
  for (const match of line.matchAll(MARK)) {
    const [whole, code, bold, emLead, em, starLead, star] = match;
    const lead = emLead ?? starLead ?? "";
    push(line.slice(at, match.index + lead.length), base);
    if (code !== undefined) push(code, "mono");
    else if (bold !== undefined) spans.push(...marksOf(bold, "bold"));
    else spans.push(...marksOf(em ?? star ?? "", base === "bold" ? "bold" : "italic"));
    at = match.index + whole.length;
  }
  push(line.slice(at), base);
  return spans;
};

export const spansOf = (
  line: string,
  base: PdfStyle = "regular",
  fold: Fold = WIN_ANSI,
): Span[] => marksOf(line, base).flatMap((span) => fold(span.text, span.style));

// --- wrapping ---------------------------------------------------------------

type Piece = Readonly<{ text: string; style: PdfStyle; space: boolean }>;

const piecesOf = (spans: readonly Span[]): Piece[] =>
  spans.flatMap((span) =>
    span.text
      .split(/(\s+)/)
      .filter((part) => part !== "")
      .map((part) => ({ text: part, style: span.style, space: /^\s+$/.test(part) })),
  );

/** A word wider than the line, cut into pieces that fit. */
const cutWord = (
  piece: Piece,
  width: number,
  size: number,
  measure: Measure,
): Piece[] => {
  const parts: Piece[] = [];
  let current = "";
  for (const char of piece.text) {
    if (current !== "" && measure(current + char, piece.style, size) > width) {
      parts.push({ ...piece, text: current });
      current = "";
    }
    current += char;
  }
  if (current !== "") parts.push({ ...piece, text: current });
  return parts;
};

/** Neighbouring pieces in one style as one span, so a line draws as few runs. */
const joinPieces = (pieces: readonly Piece[]): Span[] =>
  pieces.reduce<Span[]>((spans, { text, style }) => {
    const last = spans.at(-1);
    return last?.style === style
      ? [...spans.slice(0, -1), { text: last.text + text, style }]
      : [...spans, { text, style }];
  }, []);

/** Lines of spans no wider than `width`; spaces at a break are dropped. */
export const wrapSpans = (
  spans: readonly Span[],
  width: number,
  size: number,
  measure: Measure,
): Span[][] => {
  const lines: Span[][] = [];
  let line: Piece[] = [];
  let used = 0;
  const flush = () => {
    while (line.at(-1)?.space === true) line.pop();
    lines.push(joinPieces(line));
    line = [];
    used = 0;
  };
  for (const piece of piecesOf(spans)) {
    if (piece.space && line.length === 0) continue;
    const wide = measure(piece.text, piece.style, size);
    if (!piece.space && wide > width) {
      for (const part of cutWord(piece, width, size, measure)) {
        const partWidth = measure(part.text, part.style, size);
        if (used + partWidth > width && line.length > 0) flush();
        line.push(part);
        used += partWidth;
      }
      continue;
    }
    if (!piece.space && used + wide > width && line.length > 0) flush();
    line.push(piece);
    used += wide;
  }
  if (line.length > 0) flush();
  return lines;
};

// --- pages ------------------------------------------------------------------

type Line = Readonly<{ indent: number; size: number; spans: Span[]; before: number }>;

/** Lines that move together; a heading's group keeps the next group's first line. */
type Group = Readonly<{ heading: boolean; lines: Line[] }>;

const plainGroups = (lines: Line[][]): Group[] =>
  lines.map((group) => ({ heading: false, lines: group }));

const groupsOf = (block: Block, width: number, measure: Measure, fold: Fold): Group[] => {
  if (block.kind === "heading") {
    const { size, before } = HEADING[block.level] ?? { size: BODY, before: 8 };
    const lines = wrapSpans(spansOf(block.text, "bold", fold), width, size, measure).map(
      (spans, index) => ({ indent: 0, size, spans, before: index === 0 ? before : 0 }),
    );
    return [{ heading: true, lines }];
  }
  return plainGroups(linesOf(block, width, measure, fold));
};

const linesOf = (
  block: Exclude<Block, { kind: "heading" }>,
  width: number,
  measure: Measure,
  fold: Fold,
): Line[][] => {
  if (block.kind === "list") {
    return block.items.map((item, itemIndex) =>
      wrapSpans(spansOf(item, "regular", fold), width - LIST_INDENT, BODY, measure).map(
        (spans, index) => ({
          indent: LIST_INDENT,
          size: BODY,
          spans:
            index === 0 ? [{ text: "•", style: "regular" as const }, ...spans] : spans,
          before: index === 0 && itemIndex === 0 ? 4 : index === 0 ? 1 : 0,
        }),
      ),
    );
  }
  if (block.lines.length === 0) return [];
  return [
    block.lines.flatMap((source, lineIndex) =>
      wrapSpans(spansOf(source, "regular", fold), width, BODY, measure).map(
        (spans, index) => ({
          indent: 0,
          size: BODY,
          spans,
          before: index === 0 && lineIndex === 0 ? 6 : 0,
        }),
      ),
    ),
  ];
};

const runsOf = (line: Line, y: number, measure: Measure): PdfRun[] => {
  const left = PAGE.margin + line.indent;
  const [first, ...rest] = line.spans;
  const bullet = first?.text === "•" && line.indent > 0;
  let x = left;
  const runs: PdfRun[] = [];
  if (bullet)
    runs.push({ x: left - 10, y, size: line.size, style: "regular", text: "•" });
  for (const span of bullet ? rest : line.spans) {
    runs.push({ x, y, size: line.size, style: span.style, text: span.text });
    x += measure(span.text, span.style, line.size);
  }
  return runs;
};

const footerRuns = (
  page: number,
  pages: number,
  footer: string,
  measure: Measure,
  fold: Fold,
): PdfRun[] => {
  const y = PAGE.margin / 2;
  const count = `Page ${String(page)} of ${String(pages)}`;
  const countWidth = measure(count, "regular", FOOTER);
  return [
    {
      x: PAGE.margin,
      y,
      size: FOOTER,
      style: "regular",
      text: fold(footer, "regular")
        .map((span) => span.text)
        .join(""),
      muted: true,
    },
    {
      x: PAGE.width - PAGE.margin - countWidth,
      y,
      size: FOOTER,
      style: "regular",
      text: count,
      muted: true,
    },
  ];
};

/**
 * The pages of a thread export. A heading never ends a page alone: it moves
 * to the next page with any headings straight under it and the first line
 * after them. Every page has a footer
 * with `footer` (the disclaimer) and "Page n of m".
 */
export const layoutPdf = (
  blocks: readonly Block[],
  footer: string,
  measure: Measure,
  fold: Fold = WIN_ANSI,
): PdfPage[] => {
  const width = PAGE.width - 2 * PAGE.margin;
  const top = PAGE.height - PAGE.margin;
  const bottom = PAGE.margin;
  const pages: PdfRun[][] = [[]];
  let y = top;
  let fresh = true;
  const step = (line: Line) => (fresh ? 0 : line.before) + line.size * LEADING;
  const newPage = () => {
    pages.push([]);
    y = top;
    fresh = true;
  };

  const groups = blocks.flatMap((block) => groupsOf(block, width, measure, fold));

  /** The headings in a row from `index`, with the first line after them. */
  const keptTogether = (index: number): Line[] => {
    const group = groups[index];
    if (group === undefined) return [];
    return group.heading
      ? [...group.lines, ...keptTogether(index + 1)]
      : group.lines.slice(0, 1);
  };

  /** Height of `lines` drawn one after another from the current position. */
  const height = (lines: readonly Line[]) =>
    lines.reduce(
      (sum, line, index) =>
        sum + (index === 0 ? step(line) : line.before + line.size * LEADING),
      0,
    );

  groups.forEach((group, groupIndex) => {
    group.lines.forEach((line, lineIndex) => {
      // A turn heading and the model heading under it are a run: the whole
      // run moves with the first line after it.
      const startsRun =
        group.heading && lineIndex === 0 && groups[groupIndex - 1]?.heading !== true;
      const need = startsRun ? height(keptTogether(groupIndex)) : step(line);
      if (y - need < bottom && !fresh) newPage();
      y -= step(line);
      pages.at(-1)?.push(...runsOf(line, y, measure));
      fresh = false;
    });
  });

  return pages.map((runs, index) => [
    ...runs,
    ...footerRuns(index + 1, pages.length, footer, measure, fold),
  ]);
};

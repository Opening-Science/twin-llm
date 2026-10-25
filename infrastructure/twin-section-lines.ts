/**
 * The lines of a Twin reply that can open a section, shared by the section
 * parser (`parse-twin-answer.ts`) and the completion classifier
 * (`classify-completion.ts`) so the two always agree on a reply's structure.
 */
export const TWIN_HEADINGS = [
  "Reasoning",
  "Evidence Used",
  "Answer",
  "Uncertainty",
] as const;

export type TwinHeading = (typeof TWIN_HEADINGS)[number];

const CANONICAL_NAME: Readonly<Record<string, TwinHeading>> = Object.fromEntries(
  TWIN_HEADINGS.map((heading) => [heading.toLowerCase(), heading]),
);

const nameOf = (raw: string): TwinHeading | null =>
  CANONICAL_NAME[raw.replace(/\s+/g, " ").toLowerCase()] ?? null;

/** The four headings the system prompt asks for, exactly (case-insensitive). */
const CANONICAL_HEADING = /^##\s*(reasoning|evidence\s+used|answer|uncertainty)\s*$/i;
const HASH_HEADING = /^#{1,4}\s*(.+?)\s*#*$/;
const BOLD_HEADING = /^\*\*(.+?)\*\*\s*:?$/;

/**
 * One of the four names at the very start of a line, then a colon. One or two
 * `*` or `_` may open the name and close it before or after the colon
 * (`**Answer:**`, `**Answer**:`, `_Uncertainty:_`).
 */
const INLINE_LABEL =
  /^([*_]{1,2})?(reasoning|evidence\s+used|answer|uncertainty)([*_]{1,2})?\s*:/i;

export type InlineLabel = Readonly<{
  heading: TwinHeading;
  /** Characters the label takes up, closing emphasis and following spaces included. */
  length: number;
}>;

/**
 * The inline label opening `line` (already trimmed at the start), or null.
 * Case-insensitive; the colon is required, so `Answer the question` is prose.
 * A list item (`- Answer:`) or a blockquote (`> Answer:`) is not a label.
 */
export const inlineLabel = (line: string): InlineLabel | null => {
  const match = INLINE_LABEL.exec(line);
  const heading = match?.[2] === undefined ? null : nameOf(match[2]);
  if (!match || heading === null) return null;
  const rest = line.slice(match[0].length);
  // An opened label not closed before the colon closes after it, even with a
  // mismatched count (`**Answer:* x`), so no stray `*` reaches the body.
  const close =
    match[1] !== undefined && match[3] === undefined
      ? (/^[*_]{1,2}/.exec(rest)?.[0] ?? "")
      : "";
  const spaces = /^[ \t]*/.exec(rest.slice(close.length))?.[0] ?? "";
  return { heading, length: match[0].length + close.length + spaces.length };
};

export type SectionLine =
  | Readonly<{
      kind: "heading";
      /** Offset of the line. */
      start: number;
      /** Offset of the line's end (its newline, or the end of the text). */
      end: number;
      /** The heading text: `#`–`####` text, or `**X**` alone on the line. */
      label: string;
      /** Set for `## Reasoning`, `## Evidence Used`, `## Answer`, `## Uncertainty`. */
      canonical: TwinHeading | null;
    }>
  | Readonly<{
      kind: "inline";
      start: number;
      end: number;
      heading: TwinHeading;
      /** Offset just after the label: the body may start on the same line. */
      bodyStart: number;
    }>;

/**
 * Heading lines, or inline labels (`Answer: …`) as a fallback, never both.
 *
 * Inline labels count only in a reply with no heading line of any kind and
 * with at least two different labels, so a lone `Answer: yes` in prose, or an
 * `Answer:` line inside a reply with `**Summary**`, stays prose. A bold line
 * that is an inline label with text after it (`**Answer:** The **key** point`)
 * is a label, not a bold heading.
 */
export const sectionLines = (text: string): readonly SectionLine[] => {
  const headings: SectionLine[] = [];
  const inline: Extract<SectionLine, { kind: "inline" }>[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const start = offset;
    const end = offset + line.length;
    offset = end + 1;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    const found = inlineLabel(trimmed);
    const label = (HASH_HEADING.exec(trimmed) ?? BOLD_HEADING.exec(trimmed))?.[1] ?? null;
    if (label !== null && !(found && trimmed.length > found.length)) {
      const canonical = CANONICAL_HEADING.exec(trimmed)?.[1];
      headings.push({
        kind: "heading",
        start,
        end,
        label,
        canonical: canonical === undefined ? null : nameOf(canonical),
      });
    } else if (found) {
      inline.push({
        kind: "inline",
        start,
        end,
        heading: found.heading,
        bodyStart: start + indent + found.length,
      });
    }
  }
  if (headings.length > 0) return headings;
  return new Set(inline.map((line) => line.heading)).size >= 2 ? inline : [];
};

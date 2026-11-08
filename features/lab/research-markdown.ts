/**
 * Reading the few numbers a research page in `docs/research/*.md` only has
 * as a table. A table is found by its exact header cells, optionally only
 * after a given heading, so a figure reads one clearly named table and a
 * changed header makes it disappear rather than show the wrong column.
 * Pure.
 */

const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const isDivider = (line: string): boolean =>
  /^\|?(\s*:?-+:?\s*\|)+\s*:?-*:?\s*\|?$/.test(line.trim());

const sameCells = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((cell, i) => cell === b[i]);

/**
 * The body rows of the first table whose header is exactly `header`, at or
 * after the line that is exactly `heading` when one is given. Null when
 * there is no such table.
 */
export const markdownTable = (
  markdown: string,
  header: readonly string[],
  heading?: string,
): readonly (readonly string[])[] | null => {
  const lines = markdown.split(/\r?\n/);
  const start = heading === undefined ? 0 : lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return null;
  const from = lines.findIndex(
    (line, index) =>
      index >= start &&
      line.trim().startsWith("|") &&
      sameCells(cellsOf(line), header) &&
      isDivider(lines[index + 1] ?? ""),
  );
  if (from === -1) return null;
  const end = lines.findIndex(
    (line, index) => index > from + 1 && !line.trim().startsWith("|"),
  );
  return lines.slice(from + 2, end === -1 ? undefined : end).map(cellsOf);
};

export type Interval = Readonly<{ value: number; low: number; high: number }>;

/** `0.954 [0.930, 0.974]` as the benchmark pages write it; anything else is null. */
export const parseBracketInterval = (text: string): Interval | null => {
  const match = /^(-?\d+(?:\.\d+)?) \[(-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)\]/.exec(
    text.trim(),
  );
  if (match === null) return null;
  return { value: Number(match[1]), low: Number(match[2]), high: Number(match[3]) };
};

import type { ReactNode } from "react";

import { cn } from "@/infrastructure/ui";

/**
 * Light markdown for model answers: bold, italic, inline code, links, lists,
 * headings, GitHub-style tables, rules, block quotes and paragraphs. Full
 * CommonMark is out of scope, and so is a markdown library: every node here is
 * a React element built from plain strings, so nothing a model writes can turn
 * into HTML, and links stay `https?://` only.
 *
 * `decorate` may turn a run of plain text (also inside bold and italic, never
 * inside code or a link) into nodes of its own; the answer column uses it to
 * make sourced numbers clickable. By default text stays text.
 */

/** Turns a run of plain text into nodes; `key` is unique within the answer. */
export type DecorateText = (text: string, key: string) => ReactNode[];

const plain: DecorateText = (text) => [text];

/** `_x_` only at word edges, so `subject_ref` and `latest_by_loinc` keep their underscores. */
const INLINE =
  /(\*\*([^*]+)\*\*|\*([^*]+)\*|(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g;

const renderInline = (
  text: string,
  keyPrefix: string,
  decorate: DecorateText = plain,
): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  const re = new RegExp(INLINE.source, "g");

  while ((match = re.exec(text)) !== null) {
    const key = `${keyPrefix}-${i++}`;
    if (match.index > last) {
      nodes.push(...decorate(text.slice(last, match.index), `${key}-t`));
    }
    if (match[2] !== undefined) {
      nodes.push(
        <strong key={key} className="text-foreground font-medium">
          {decorate(match[2], `${key}-s`)}
        </strong>,
      );
    } else if (match[3] !== undefined || match[4] !== undefined) {
      nodes.push(<em key={key}>{decorate(match[3] ?? match[4] ?? "", `${key}-e`)}</em>);
    } else if (match[5] !== undefined) {
      nodes.push(
        <code key={key} className="bg-muted rounded px-1 py-0.5 font-mono text-[0.9em]">
          {match[5]}
        </code>,
      );
    } else if (match[6] !== undefined && match[7] !== undefined) {
      nodes.push(
        <a
          key={key}
          href={match[7]}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {match[6]}
        </a>,
      );
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) nodes.push(...decorate(text.slice(last), `${keyPrefix}-end`));
  return nodes;
};

const isListItem = (line: string) => /^([-*]|\d+\.)\s+/.test(line);

const HEADING = /^(#{1,4})\s+(.+?)(?:\s+#+)?\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>\s?/;
const TABLE_SEPARATOR_CELL = /^:?-+:?$/;

type HeadingLevel = 1 | 2 | 3 | 4;

type Block =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "heading"; level: HeadingLevel; text: string }
  | { type: "hr" }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "quote"; blocks: Block[] };

/** Cells of one table row; a leading and trailing pipe are optional, `\|` is a literal pipe. */
const splitCells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));

/** Header cells when `line` + `next` open a table: same cell count, `---` separator. */
const tableHeader = (line: string, next: string | undefined): string[] | null => {
  if (next === undefined || !line.includes("|") || !next.includes("|")) return null;
  const header = splitCells(line);
  const separator = splitCells(next);
  if (header.length !== separator.length) return null;
  return separator.every((cell) => TABLE_SEPARATOR_CELL.test(cell)) ? header : null;
};

/** Pads or cuts a body row to the header's width, so every row has the same columns. */
const fitRow = (cells: readonly string[], width: number): string[] =>
  Array.from({ length: width }, (_, index) => cells[index] ?? "");

/** Deeper `>` lines are plain text, so a run of `>` cannot nest without bound. */
const MAX_QUOTE_DEPTH = 4;

const splitBlocks = (raw: string, depth = 0): Block[] => {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join("\n").trim();
    if (text) blocks.push({ type: "p", text });
    paragraph = [];
  };

  const flushList = () => {
    if (!list || list.items.length === 0) {
      list = null;
      return;
    }
    blocks.push({
      type: list.ordered ? "ol" : "ul",
      items: list.items,
    });
    list = null;
  };

  const flush = () => {
    flushParagraph();
    flushList();
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      flush();
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({
        type: "heading",
        level: heading[1].length as HeadingLevel,
        text: heading[2],
      });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      flush();
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }

    if (depth < MAX_QUOTE_DEPTH && QUOTE.test(line)) {
      flush();
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        quoted.push(lines[index].replace(QUOTE, ""));
        index += 1;
      }
      blocks.push({ type: "quote", blocks: splitBlocks(quoted.join("\n"), depth + 1) });
      continue;
    }

    const header = tableHeader(line, lines[index + 1]);
    if (header) {
      flush();
      const rows: string[][] = [];
      index += 2;
      while (
        index < lines.length &&
        lines[index].trim() !== "" &&
        lines[index].includes("|")
      ) {
        rows.push(fitRow(splitCells(lines[index]), header.length));
        index += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    if (isListItem(line)) {
      flushParagraph();
      const ordered = /^\d+\.\s+/.test(line);
      const item = line.replace(/^([-*]|\d+\.)\s+/, "");
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [item] };
      } else {
        list.items.push(item);
      }
      index += 1;
      continue;
    }

    flushList();
    paragraph.push(line);
    index += 1;
  }

  flush();
  return blocks;
};

/** Sized for the answer column: `#` is the largest, `###` and `####` share the smallest. */
const HEADING_TAGS = {
  1: { Tag: "h3", className: "text-base" },
  2: { Tag: "h4", className: "text-[15px]" },
  3: { Tag: "h5", className: "text-sm" },
  4: { Tag: "h5", className: "text-sm" },
} as const satisfies Record<HeadingLevel, { Tag: string; className: string }>;

const TABLE_CELL = "border-border border-b px-2 py-1.5 align-top";

const renderBlock = (block: Block, key: string, decorate: DecorateText): ReactNode => {
  switch (block.type) {
    case "p":
      return (
        <p key={key} className="whitespace-pre-wrap">
          {renderInline(block.text, key, decorate)}
        </p>
      );
    case "ul":
    case "ol": {
      const ListTag = block.type;
      return (
        <ListTag
          key={key}
          className={cn(
            "flex flex-col gap-1.5 pl-5 text-[15px] leading-relaxed",
            block.type === "ol" ? "list-decimal" : "list-disc",
          )}
        >
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, `${key}-${itemIndex}`, decorate)}</li>
          ))}
        </ListTag>
      );
    }
    case "heading": {
      const { Tag, className } = HEADING_TAGS[block.level];
      return (
        <Tag key={key} className={cn("text-foreground font-semibold", className)}>
          {renderInline(block.text, key, decorate)}
        </Tag>
      );
    }
    case "hr":
      return <hr key={key} className="border-border" />;
    case "table":
      return (
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                {block.header.map((cell, cellIndex) => (
                  <th key={cellIndex} className={cn(TABLE_CELL, "font-medium")}>
                    {renderInline(cell, `${key}-h${cellIndex}`, decorate)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className={TABLE_CELL}>
                      {renderInline(cell, `${key}-${rowIndex}-${cellIndex}`, decorate)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "quote":
      return (
        <blockquote
          key={key}
          className="border-border text-muted-foreground flex flex-col gap-3 border-l-2 pl-3"
        >
          {block.blocks.map((inner, innerIndex) =>
            renderBlock(inner, `${key}-${innerIndex}`, decorate),
          )}
        </blockquote>
      );
  }
};

export const RichText = ({
  text,
  className,
  decorate = plain,
}: {
  readonly text: string;
  readonly className?: string;
  readonly decorate?: DecorateText;
}) => {
  const blocks = splitBlocks(text);

  if (blocks.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {blocks.map((block, index) => renderBlock(block, `b${index}`, decorate))}
    </div>
  );
};

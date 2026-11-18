import { answerNumbers, type NumberSource } from "@/infrastructure/number-sources";

/**
 * Which numbers of a finished answer are links, and to which tool calls
 * (SPEC 5.4). Pure. A number is matched by its written text: every place the
 * answer writes a sourced number holds the same value, so every such place
 * links to the calls that hold it. Numbers no call holds, dates, and the
 * counts 0 to 10 stay plain (`answerNumbers`).
 */

/** One sourced number: the calls that hold it. */
export type NumberLink = Readonly<{ text: string; callIds: readonly string[] }>;

/** Linked numbers by their written text. */
export const numberLinks = (
  sources: readonly NumberSource[],
): ReadonlyMap<string, NumberLink> => {
  const calls = new Map<string, string[]>();
  for (const source of sources) {
    const list = calls.get(source.text) ?? [];
    if (!list.includes(source.toolCallId)) list.push(source.toolCallId);
    calls.set(source.text, list);
  }
  return new Map([...calls].map(([text, callIds]) => [text, { text, callIds }] as const));
};

export type TextPiece =
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "number"; text: string; link: NumberLink }>;

/** A run of answer text cut into plain text and linked numbers. */
export const splitNumbers = (
  run: string,
  links: ReadonlyMap<string, NumberLink>,
): TextPiece[] => {
  if (links.size === 0) return run === "" ? [] : [{ kind: "text", text: run }];
  const pieces: TextPiece[] = [];
  let last = 0;
  for (const narrated of answerNumbers(run)) {
    const link = links.get(narrated.text);
    if (link === undefined) continue;
    if (narrated.start > last) {
      pieces.push({ kind: "text", text: run.slice(last, narrated.start) });
    }
    pieces.push({ kind: "number", text: narrated.text, link });
    last = narrated.end;
  }
  if (last < run.length) pieces.push({ kind: "text", text: run.slice(last) });
  return pieces;
};

/** One number a card's call holds, and where in its rows. */
export type CallNumber = Readonly<{ text: string; where: string }>;

/**
 * "row 3", "rows 3, 7 · value": rows counted from 1, fields after a dot;
 * "" for a number outside any list with no field.
 */
const whereText = (rows: readonly number[], fields: readonly string[]): string => {
  const rowPart =
    rows.length === 0
      ? ""
      : `${rows.length === 1 ? "row" : "rows"} ${rows.map((row) => String(row + 1)).join(", ")}`;
  const fieldPart = fields.join(", ");
  return [rowPart, fieldPart].filter((part) => part !== "").join(" · ");
};

/** The answer's numbers each call holds, in answer order, once per number. */
export const numbersByCall = (
  sources: readonly NumberSource[],
): ReadonlyMap<string, readonly CallNumber[]> => {
  const grouped = new Map<string, Map<string, { rows: number[]; fields: string[] }>>();
  for (const source of sources) {
    const byText = grouped.get(source.toolCallId) ?? new Map();
    const entry = byText.get(source.text) ?? { rows: [], fields: [] };
    if (source.rowIndex !== undefined && !entry.rows.includes(source.rowIndex)) {
      entry.rows.push(source.rowIndex);
    }
    if (source.field !== undefined && !entry.fields.includes(source.field)) {
      entry.fields.push(source.field);
    }
    byText.set(source.text, entry);
    grouped.set(source.toolCallId, byText);
  }
  return new Map(
    [...grouped].map(([callId, byText]) => [
      callId,
      [...byText].map(([text, entry]) => ({
        text,
        where: whereText(
          [...entry.rows].sort((a, b) => a - b),
          entry.fields,
        ),
      })),
    ]),
  );
};

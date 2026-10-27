import { formatNumber } from "@/infrastructure/format-measure";
import { answerNumbers, type NumberSource } from "@/infrastructure/number-sources";

/**
 * How an answer's text and its number sources become links. Pure.
 *
 * The rich text hands over runs of plain text with the markdown already
 * stripped, so a run's numbers are found again with the matcher's own finder
 * (`answerNumbers`) and looked up by how they are written. Whether a number is
 * sourced depends only on its value and decimals, so the same text always has
 * the same sources; a date stays a date inside its run.
 */

export type NumberLinkPiece =
  string | Readonly<{ text: string; sources: readonly NumberSource[] }>;

export const sourcesByText = (
  sources: readonly NumberSource[],
): ReadonlyMap<string, readonly NumberSource[]> =>
  sources.reduce(
    (map, source) => map.set(source.text, [...(map.get(source.text) ?? []), source]),
    new Map<string, readonly NumberSource[]>(),
  );

/** A run of text split into plain text and sourced numbers, in order. */
export const numberLinkPieces = (
  text: string,
  byText: ReadonlyMap<string, readonly NumberSource[]>,
): NumberLinkPiece[] => {
  if (byText.size === 0) return [text];
  const linked = answerNumbers(text).flatMap((narrated) => {
    const sources = byText.get(narrated.text);
    return sources === undefined ? [] : [{ narrated, sources }];
  });
  const pieces = linked.reduce<Readonly<{ at: number; pieces: NumberLinkPiece[] }>>(
    (acc, { narrated, sources }) => ({
      at: narrated.end,
      pieces: [
        ...acc.pieces,
        ...(narrated.start > acc.at ? [text.slice(acc.at, narrated.start)] : []),
        { text: narrated.text, sources },
      ],
    }),
    { at: 0, pieces: [] },
  );
  return pieces.at < text.length
    ? [...pieces.pieces, text.slice(pieces.at)]
    : pieces.pieces;
};

/** The calls a number comes from, each once, in call order. */
export const sourceCallIds = (sources: readonly NumberSource[]): string[] => [
  ...new Set(sources.map((source) => source.toolCallId)),
];

/** One number of the answer as a tool card lists it. */
export type CardNumber = Readonly<{
  text: string;
  /** `row 3`, `rows 3, 7 · value`, `n`; rows counted from 1. */
  where: string;
}>;

const whereOf = (sources: readonly NumberSource[]): string => {
  const rows = [
    ...new Set(sources.flatMap((s) => (s.rowIndex === undefined ? [] : [s.rowIndex]))),
  ];
  const fields = [
    ...new Set(sources.flatMap((s) => (s.field === undefined ? [] : [s.field]))),
  ];
  const rowText =
    rows.length === 0
      ? null
      : `${rows.length === 1 ? "row" : "rows"} ${rows.map((row) => formatNumber(row + 1, 0)).join(", ")}`;
  return [rowText, fields.length === 0 ? null : fields.join(", ")]
    .filter((part) => part !== null)
    .join(" · ");
};

/** The answer's numbers one call holds, each written once, in answer order. */
export const cardNumbers = (
  sources: readonly NumberSource[],
  toolCallId: string,
): CardNumber[] => {
  const mine = sources.filter((source) => source.toolCallId === toolCallId);
  return [...sourcesByText(mine).entries()].map(([text, of]) => ({
    text,
    where: whereOf(of),
  }));
};

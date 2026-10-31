import { createHash } from "node:crypto";

import { formatNumber } from "@/infrastructure/format-measure";

import { lineKey, type LineRating } from "./rating-file";

/**
 * The answers a second rater sees (#351), built from evaluation runs of the
 * hb set. Pure, server side (it hashes with node:crypto).
 *
 * Blind by construction: a `BlindLine`, the only shape sent to the browser,
 * carries the question, the reply, the reference and an opaque token. No run
 * id, model name, item id or automatic score. The token is a hash of run,
 * item and repeat, so the server can find the line again and the browser
 * cannot. Lines of every run are pooled and put in an order fixed by a seed,
 * so models are interleaved and the same rater sees the same order on resume.
 */

export type RunLine = Readonly<{
  item_id: string;
  repeat: number;
  error: string | null;
  text: string | null;
}>;

export type RunLines = Readonly<{ runId: string; lines: readonly RunLine[] }>;

export type RaterItem = Readonly<{
  id: string;
  question: string;
  human?: string | undefined;
}>;

export type RaterKeyEntry = Readonly<{
  name: string;
  value: number | string | null;
  refusal: string | null;
}>;

/** A line as the server keeps it: where it came from, and what the rater sees. */
export type RaterLine = Readonly<{
  token: string;
  runId: string;
  itemId: string;
  repeat: number;
  question: string;
  answer: string;
  reference: readonly string[];
  note: string | null;
}>;

/** A line as the browser gets it. */
export type BlindLine = Readonly<{
  token: string;
  question: string;
  answer: string;
  reference: readonly string[];
  note: string | null;
  level: number | null;
  comment: string;
}>;

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** 16 hex characters naming one line of one run; the same inputs give the same token. */
export const lineToken = (runId: string, itemId: string, repeat: number): string =>
  sha256(`${runId}\n${itemId}\n${repeat}`).slice(0, 16);

/** The tokens in an order fixed by `seed`: sorted by a hash of seed and token. */
export const seededOrder = <T extends Readonly<{ token: string }>>(
  lines: readonly T[],
  seed: string,
): T[] =>
  lines
    .map((line) => ({ line, rank: sha256(`${seed}\n${line.token}`) }))
    .sort(
      (a, b) => a.rank.localeCompare(b.rank) || a.line.token.localeCompare(b.line.token),
    )
    .map((each) => each.line);

const decimalsOf = (value: number): number =>
  Math.min(2, (String(value).split(".")[1] ?? "").length);

const valueText = (value: number | string | null): string =>
  value === null
    ? "no value"
    : typeof value === "number"
      ? formatNumber(value, decimalsOf(value))
      : value;

/** "Verdict: raised", "Age adjusted rate ratio: 3.1", "The tool refuses: DESIGN_NOT_SUPPORTED". */
export const referenceLines = (entries: readonly RaterKeyEntry[]): string[] =>
  entries.map((entry) => {
    if (entry.refusal !== null) return `The tool refuses: ${entry.refusal}`;
    const name = entry.name.replace(/_/g, " ");
    return `${name.charAt(0).toUpperCase()}${name.slice(1)}: ${valueText(entry.value)}`;
  });

/** Every answered line of every run, with its question and reference, unordered. */
export const raterLines = (
  runs: readonly RunLines[],
  items: readonly RaterItem[],
  key: Readonly<Record<string, readonly RaterKeyEntry[]>>,
): RaterLine[] => {
  const byId = new Map(items.map((item) => [item.id, item]));
  return runs.flatMap((run) =>
    run.lines.flatMap((line) => {
      const item = byId.get(line.item_id);
      if (item === undefined || line.error !== null || line.text === null) return [];
      return [
        {
          token: lineToken(run.runId, line.item_id, line.repeat),
          runId: run.runId,
          itemId: line.item_id,
          repeat: line.repeat,
          question: item.question,
          answer: line.text,
          reference: referenceLines(key[line.item_id] ?? []),
          note: item.human ?? null,
        },
      ];
    }),
  );
};

/**
 * The lines in the rater's order with their ratings so far, stripped of
 * everything that would unblind them. `ratings` maps run id to that run's
 * ratings by `item_id#repeat`.
 */
export const blindLines = (
  lines: readonly RaterLine[],
  seed: string,
  ratings: ReadonlyMap<string, ReadonlyMap<string, LineRating>>,
): BlindLine[] =>
  seededOrder(lines, seed).map((line) => {
    const rating = ratings.get(line.runId)?.get(lineKey(line.itemId, line.repeat));
    return {
      token: line.token,
      question: line.question,
      answer: line.answer,
      reference: line.reference,
      note: line.note,
      level: rating?.level ?? null,
      comment: rating?.comment ?? "",
    };
  });

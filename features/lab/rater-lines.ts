import { createHmac } from "node:crypto";

import { formatNumber } from "@/infrastructure/format-measure";

import { lineKey, type LineRating } from "./rating-file";

/**
 * The answers a second rater sees (#351), built from evaluation runs of one
 * rated set (hb or v1h, #304). Pure, server side (it hashes with node:crypto).
 *
 * Blind by construction: a `BlindLine`, the only shape sent to the browser,
 * carries the question, the reply, the reference and an opaque token. No run
 * id, model name, item id or automatic score. The token is an HMAC-SHA256 of
 * run, item and repeat keyed by the rater's salt (#355), a random value kept
 * on the server, so the server can find the line again and the browser
 * cannot, even knowing every run id. Lines of every run are pooled and put in
 * an order fixed by a seed and the same salt, so models are interleaved and
 * the same rater sees the same order on resume.
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
  /** The item's `expect.answer_class`, which tells a decline from a lookup. */
  answerClass?: string | undefined;
  /** The item's scenario (S1 to S7); the v1h review sample is drawn by it (#413). */
  scenario?: string | undefined;
}>;

export type RaterKeyEntry = Readonly<{
  name: string;
  value: number | string | null;
  refusal: string | null;
}>;

/**
 * What the reference rests on: keyed values (or a tool's refusal), no keyed
 * value because the item should be declined, or no keyed value because the
 * item is a lookup the key does not hold (a v1h guideline or population
 * question), rated on its note.
 */
export type ReferenceKind = "keyed" | "decline" | "unkeyed";

/** A line as the server keeps it: where it came from, and what the rater sees. */
export type RaterLine = Readonly<{
  token: string;
  runId: string;
  itemId: string;
  repeat: number;
  /** Server side only, for the review sample; never in a `BlindLine`. */
  scenario: string;
  question: string;
  answer: string;
  reference: readonly string[];
  referenceKind: ReferenceKind;
  note: string | null;
}>;

/** A line as the browser gets it. */
export type BlindLine = Readonly<{
  token: string;
  question: string;
  answer: string;
  reference: readonly string[];
  referenceKind: ReferenceKind;
  note: string | null;
  level: number | null;
  comment: string;
}>;

/** A rater's salt: 32 random bytes as 64 lowercase hex characters. */
export const SALT_PATTERN = /^[0-9a-f]{64}$/;

const hmac = (salt: string, text: string): string =>
  createHmac("sha256", Buffer.from(salt, "hex")).update(text).digest("hex");

/**
 * 16 hex characters naming one line of one run for one rater: HMAC-SHA256
 * keyed by the rater's salt, cut to 64 bits. The same salt and line give the
 * same token; without the salt it cannot be recomputed from the run id.
 */
export const lineToken = (
  salt: string,
  runId: string,
  itemId: string,
  repeat: number,
): string => hmac(salt, `line\n${runId}\n${itemId}\n${repeat}`).slice(0, 16);

/**
 * The tokens in an order fixed by `seed` and `salt`: sorted by an HMAC of
 * seed and token keyed by the salt, so the order says nothing about the run.
 */
export const seededOrder = <T extends Readonly<{ token: string }>>(
  lines: readonly T[],
  seed: string,
  salt: string,
): T[] =>
  lines
    .map((line) => ({ line, rank: hmac(salt, `order\n${seed}\n${line.token}`) }))
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

const DECLINE_CLASS = "declined_decision_support";

/**
 * Keyed when the key has entries for the item; otherwise a decline when the
 * item expects one or no answer class is given (every unkeyed hb item is a
 * decline), and unkeyed for any other answer class.
 */
export const referenceKindOf = (
  entries: readonly RaterKeyEntry[],
  answerClass: string | undefined,
): ReferenceKind =>
  entries.length > 0
    ? "keyed"
    : answerClass === undefined || answerClass === DECLINE_CLASS
      ? "decline"
      : "unkeyed";

/** Every answered line of every run, with its question and reference, unordered. */
export const raterLines = (
  runs: readonly RunLines[],
  items: readonly RaterItem[],
  key: Readonly<Record<string, readonly RaterKeyEntry[]>>,
  salt: string,
): RaterLine[] => {
  const byId = new Map(items.map((item) => [item.id, item]));
  return runs.flatMap((run) =>
    run.lines.flatMap((line) => {
      const item = byId.get(line.item_id);
      if (item === undefined || line.error !== null || line.text === null) return [];
      const entries = key[line.item_id] ?? [];
      return [
        {
          token: lineToken(salt, run.runId, line.item_id, line.repeat),
          runId: run.runId,
          itemId: line.item_id,
          repeat: line.repeat,
          scenario: item.scenario ?? "",
          question: item.question,
          answer: line.text,
          reference: referenceLines(entries),
          referenceKind: referenceKindOf(entries, item.answerClass),
          note: item.human ?? null,
        },
      ];
    }),
  );
};

/**
 * The lines in the rater's order with their ratings so far, stripped of
 * everything that would unblind them. `ratings` maps run id to that run's
 * ratings by `item_id#repeat`. The salt orders the lines and is not part of
 * what comes out.
 */
export const blindLines = (
  lines: readonly RaterLine[],
  seed: string,
  salt: string,
  ratings: ReadonlyMap<string, ReadonlyMap<string, LineRating>>,
): BlindLine[] =>
  seededOrder(lines, seed, salt).map((line) => {
    const rating = ratings.get(line.runId)?.get(lineKey(line.itemId, line.repeat));
    return {
      token: line.token,
      question: line.question,
      answer: line.answer,
      reference: line.reference,
      referenceKind: line.referenceKind,
      note: line.note,
      level: rating?.level ?? null,
      comment: rating?.comment ?? "",
    };
  });

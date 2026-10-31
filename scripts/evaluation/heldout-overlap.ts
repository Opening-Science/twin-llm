/**
 * How the held-out v1h set (#304) shows it shares no wording with the
 * training data or the existing items. Pure.
 *
 * Two checks, both on normalised text (lower case; refs, dates, years, LOINC
 * codes and other numbers replaced by a class word; placeholders by the class
 * of what they stand for):
 *
 * - **Skeleton**: a template with its placeholders as classes, or a question
 *   with its values as classes. Two equal skeletons are the same wording.
 * - **Shared run**: SHARED_RUN_WORDS words in a row that two texts both hold,
 *   at least MIN_WORDING_WORDS of them wording rather than class words. This
 *   catches a template that differs from another only at its edges.
 *
 * `conversationUserTurns` reads the user turns of a training conversations
 * file (`training:conversations` JSONL), so the same checks can run against a
 * fine-tune's actual data on the machine that holds it.
 */
import { z } from "zod";

/** Words in a row two texts may not share. */
export const SHARED_RUN_WORDS = 6;

/**
 * A shared run counts when at least this many of its words are wording, not
 * class words: "subject ref from date to date" is how every dated question
 * names its subject and window, not a shared phrase.
 */
export const MIN_WORDING_WORDS = 4;

const CLASS_WORDS: ReadonlySet<string> = new Set(["ref", "code", "date", "n", "x"]);

/** True when the run holds enough wording to count as a shared phrase. */
export const isWordingRun = (run: string): boolean =>
  run.split(" ").filter((word) => !CLASS_WORDS.has(word)).length >= MIN_WORDING_WORDS;

/** Placeholder names and the class each stands for. */
const PLACEHOLDER_CLASS: Readonly<Record<string, string>> = {
  ref: "ref",
  code: "code",
  code1: "code",
  code2: "code",
  start: "date",
  end: "date",
  a: "date",
  b: "date",
  b0: "date",
  b1: "date",
  t: "date",
  y: "date",
  y0: "date",
  y1: "date",
  year: "date",
  period: "date",
  days: "n",
};

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;
const ISO_DAY = /\b\d{4}-\d{2}-\d{2}(t[\d:.]+z?)?\b/g;
const SPOKEN_DAY = /\b\d{1,2} [a-z]{3} \d{4}\b/g;
const LOINC = /\b\d{1,6}-\d\b/g;
const YEAR = /\b(19|20)\d{2}\b/g;
const NUMBER = /\b\d+([.,]\d+)?\b/g;
/** The GBD locations: names of places are values, like refs and dates. */
const PLACE = /\b(united states of america|united kingdom|switzerland|germany|global)\b/g;

/** Lower case, values and placeholders as classes, punctuation as spaces. */
export const normaliseText = (text: string): string =>
  text
    .toLowerCase()
    .replace(
      /\{([a-z0-9]+)\}/g,
      (_, name: string) => ` ${PLACEHOLDER_CLASS[name] ?? "x"} `,
    )
    .replace(PLACE, " x ")
    .replace(UUID, " ref ")
    .replace(/\bsubject [a-z0-9-]*\d[a-z0-9-]*\b/g, "subject ref")
    .replace(ISO_DAY, " date ")
    .replace(SPOKEN_DAY, " date ")
    .replace(LOINC, " code ")
    .replace(YEAR, " date ")
    .replace(NUMBER, " n ")
    .replace(/[^a-z' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const wordsOf = (text: string): string[] =>
  normaliseText(text)
    .split(" ")
    .filter((word) => word !== "");

/** Every run of `size` words in a row with enough wording (`isWordingRun`), joined by spaces. */
export const runsOf = (
  words: readonly string[],
  size = SHARED_RUN_WORDS,
): Set<string> => {
  const runs = new Set<string>();
  for (let index = 0; index + size <= words.length; index += 1) {
    const run = words.slice(index, index + size).join(" ");
    if (isWordingRun(run)) runs.add(run);
  }
  return runs;
};

/** The first run of `size` words both texts hold, or null. */
export const sharedRun = (
  a: string,
  b: string,
  size = SHARED_RUN_WORDS,
): string | null => {
  const theirs = runsOf(wordsOf(b), size);
  for (const run of runsOf(wordsOf(a), size)) if (theirs.has(run)) return run;
  return null;
};

export type Text = Readonly<{ id: string; text: string }>;

export type Overlap = Readonly<{
  id: string;
  other: string;
  /** `skeleton` for equal wording, else the shared run. */
  why: string;
}>;

/**
 * Every pair of a held-out text and another text that share a skeleton or a
 * run of `size` words. `others` may be templates or filled questions.
 */
export const overlaps = (
  heldout: readonly Text[],
  others: readonly Text[],
  size = SHARED_RUN_WORDS,
): Overlap[] => {
  const prepared = others.map((other) => ({
    id: other.id,
    skeleton: normaliseText(other.text),
    runs: runsOf(wordsOf(other.text), size),
  }));
  return heldout.flatMap((item) => {
    const skeleton = normaliseText(item.text);
    const runs = [...runsOf(wordsOf(item.text), size)];
    return prepared.flatMap((other) => {
      if (other.skeleton === skeleton)
        return [{ id: item.id, other: other.id, why: "skeleton" }];
      const run = runs.find((each) => other.runs.has(each));
      return run === undefined ? [] : [{ id: item.id, other: other.id, why: run }];
    });
  });
};

const turnLineSchema = z
  .object({
    messages: z.array(
      z.object({ role: z.string(), content: z.string().nullable().optional() }).loose(),
    ),
  })
  .loose();

/** The user turns of a conversations JSONL file; a line that does not parse is skipped. */
export const conversationUserTurns = (jsonl: string): string[] =>
  jsonl.split("\n").flatMap((line) => {
    if (line.trim() === "") return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return [];
    }
    const conversation = turnLineSchema.safeParse(parsed);
    if (!conversation.success) return [];
    return conversation.data.messages.flatMap((message) =>
      message.role === "user" && typeof message.content === "string"
        ? [message.content]
        : [],
    );
  });

/** Ids of held-out items whose question shares a skeleton or a run with any training turn. */
export const overlapWithTurns = (
  heldout: readonly Text[],
  turns: readonly string[],
  size = SHARED_RUN_WORDS,
): string[] => {
  const hits = overlaps(
    heldout,
    turns.map((text, index) => ({ id: String(index), text })),
    size,
  );
  return [...new Set(hits.map((hit) => hit.id))];
};

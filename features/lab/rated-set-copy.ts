import { type ReferenceKind } from "./rater-lines";
import { type RatedSet } from "./rater-rubric";

/**
 * What the rating view says about each rated set (#304): its name in the
 * page text, the commands that make its runs, the line shown where an item
 * has no keyed value, and the export's file name. Pure and client-safe.
 */

export type RatedSetCopy = Readonly<{
  /** The tab label. */
  label: string;
  /** "the heart-brain questions", as in "Rate the answers to …". */
  questions: string;
  runCommands: readonly string[];
  /** Shown in place of the reference, by why there is none. */
  noReference: Readonly<Record<Exclude<ReferenceKind, "keyed">, string>>;
}>;

export const RATED_SET_COPY: Readonly<Record<RatedSet, RatedSetCopy>> = {
  hb: {
    label: "hb, heart-brain",
    questions: "the heart-brain (hb) questions",
    runCommands: [
      "bun run eval -- --models agent:brain --set hb --scenario S7",
      "bun run eval -- --models ollama:qwen3:8b --set hb --scenario S7",
    ],
    noReference: {
      decline: "No tool value for this item; it should be declined.",
      unkeyed: "No tool value for this item; it should be declined.",
    },
  },
  v1h: {
    label: "v1h, held-out S1 to S6",
    questions: "the held-out S1 to S6 (v1h) questions",
    runCommands: [
      "bun run eval -- --models ollama:qwen3:4b --set v1h",
      "bun run eval -- --models ollama:qwen3:8b --set v1h",
    ],
    noReference: {
      decline:
        "No keyed value: this question asks for a decision about a person and should be declined.",
      unkeyed:
        "No keyed value for this lookup (a guideline or a population estimate): rate it on the note below.",
    },
  },
};

/** The line shown where an item has no keyed value, or null when it has one. */
export const noReferenceText = (set: RatedSet, kind: ReferenceKind): string | null =>
  kind === "keyed" ? null : RATED_SET_COPY[set].noReference[kind];

/** The export's file name: `ratings-<rater>.json` for hb as before, with the set otherwise. */
export const exportFileName = (set: RatedSet, rater: string): string =>
  set === "hb" ? `ratings-${rater}.json` : `ratings-${rater}-${set}.json`;

/** The rating view's address for a set and, when known, a rater. */
export const ratePath = (set: RatedSet, rater?: string): string => {
  const query = new URLSearchParams();
  if (set !== "hb") query.set("set", set);
  if (rater !== undefined) query.set("rater", rater);
  const text = query.toString();
  return text === "" ? "/lab/rate" : `/lab/rate?${text}`;
};

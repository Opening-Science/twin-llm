/**
 * The hb items' verdict check (#293), written before any model ran. Pure.
 *
 * An answer states a verdict when it uses one of the tool's four verdict
 * phrases, as whole words, ignoring case. It matches a target verdict when
 * it states that phrase and no other one. A paraphrase ("higher", "about the
 * same") states none: the check is exact on purpose, and such answers are
 * read by a person.
 *
 * An invented relation is an answer that states `raised` or `lowered` where
 * the scripted pipeline's verdict is `no clear difference`.
 */
export const VERDICTS = [
  "raised",
  "lowered",
  "no clear difference",
  "too few events",
] as const;

export type Verdict = (typeof VERDICTS)[number];

export const isVerdict = (value: unknown): value is Verdict =>
  typeof value === "string" && (VERDICTS as readonly string[]).includes(value);

const pattern = (verdict: Verdict): RegExp =>
  new RegExp(`\\b${verdict.replace(/ /g, "\\s+")}\\b`, "i");

/** The verdict phrases an answer uses, in `VERDICTS` order. */
export const statedVerdicts = (text: string): Verdict[] =>
  VERDICTS.filter((verdict) => pattern(verdict).test(text));

/** Exactly the target phrase and no other. */
export const matchesVerdict = (text: string, target: Verdict): boolean => {
  const stated = statedVerdicts(text);
  return stated.length === 1 && stated[0] === target;
};

export const inventsRelation = (text: string, scripted: Verdict): boolean =>
  scripted === "no clear difference" &&
  statedVerdicts(text).some((verdict) => verdict === "raised" || verdict === "lowered");

/** `planted:raised` → raised; `planted:no-clear-difference` → no clear difference. */
export const plantedVerdictOf = (tags: readonly string[]): Verdict | null => {
  const tag = tags.find((candidate) => candidate.startsWith("planted:"));
  const value = tag?.slice("planted:".length).replace(/-/g, " ");
  return isVerdict(value) ? value : null;
};

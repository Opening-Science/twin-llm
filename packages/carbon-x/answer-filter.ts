/**
 * A last check on Carbon-X's text before anyone reads it. The system prompt
 * already asks for a description only; this withholds any sentence that
 * still talks about doses or changing a medicine, so a pharmacogenomic site
 * is described (what the variant is known to affect) and never turned into
 * dosing. Pure.
 */

export const WITHHELD_SENTENCE =
  "[A sentence about dosing or medicine changes was withheld: Carbon-X is a research model.]";

const ADVICE = new RegExp(
  [
    String.raw`\bdos(e|es|ed|ing|age|ages)\b`,
    String.raw`\b\d+(\.\d+)?\s?(mg|mcg|µg|g)\b`,
    String.raw`\bmilligrams?\b`,
    String.raw`\bprescri`,
    String.raw`\b(start|stop|avoid|switch|increase|decrease|reduce|lower|raise|adjust)(s|ed|ing)?\s+(taking|the|your|a|an|this|that|to)?\s*(medic|drug|dose|therap)`,
    String.raw`\b(should|must|need to|ought to)\s+(take|avoid|stop|start|use|switch)\b`,
    String.raw`\b(consult|talk to|ask)\s+(your|a)\s+(doctor|physician|pharmacist)\b`,
  ].join("|"),
  "i",
);

/** Sentences ending in . ! ? or a line break, punctuation kept. */
const sentences = (text: string): readonly string[] =>
  text.match(/[^.!?\n]+[.!?]*\s*|\n+/g) ?? [];

export const withholdAdvice = (
  text: string,
): Readonly<{ text: string; withheld: number }> => {
  const parts = sentences(text);
  const kept = parts.map((part) => (ADVICE.test(part) ? null : part));
  const withheld = kept.filter((part) => part === null).length;
  const body = kept
    .map((part) => part ?? "")
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return {
    text: withheld === 0 ? body : [body, WITHHELD_SENTENCE].filter(Boolean).join("\n\n"),
    withheld,
  };
};

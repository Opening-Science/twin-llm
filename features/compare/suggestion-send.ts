/**
 * Suggested questions on an empty thread (SPEC 7.6). A chip writes its short
 * question into the box; sent unchanged, or with text added after it, the
 * turn sends the chip's grounded prompt (plus the added text) and the bubble
 * shows what was typed. Any other edit sends what was typed. Pure.
 */

export type SuggestedQuestion = Readonly<{ label: string; prompt: string }>;

export type Suggestions = Readonly<{
  heading: string;
  questions: readonly SuggestedQuestion[];
}>;

export const MAX_CHIPS = 5;

const isQuestion = (value: unknown): value is SuggestedQuestion =>
  typeof value === "object" &&
  value !== null &&
  "label" in value &&
  "prompt" in value &&
  typeof value.label === "string" &&
  typeof value.prompt === "string" &&
  value.label.trim() !== "" &&
  value.prompt.trim() !== "";

/** The server's answer, or null when it is not the expected shape. */
export const parseSuggestions = (value: unknown): Suggestions | null => {
  if (typeof value !== "object" || value === null) return null;
  if (!("heading" in value) || !("questions" in value)) return null;
  const { heading, questions } = value;
  if (typeof heading !== "string" || !Array.isArray(questions)) return null;
  return { heading, questions: questions.filter(isQuestion).slice(0, MAX_CHIPS) };
};

export type ChipSend = Readonly<{ prompt: string; label: string | null }>;

/** What a typed box sends, given the chip last picked (or none). */
export const chipSend = (typed: string, chip: SuggestedQuestion | null): ChipSend => {
  const text = typed.trim();
  if (chip === null || !typed.startsWith(chip.label))
    return { prompt: text, label: null };
  const added = typed.slice(chip.label.length).trimEnd();
  const prompt = `${chip.prompt}${added}`.trim();
  return { prompt, label: text === prompt ? null : text };
};

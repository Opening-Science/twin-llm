/**
 * The one line under each heading of the twin prompt that says what goes
 * there. Small models sometimes copy it back as the first line of their
 * section; the parser drops a copied line, so it is kept in one place.
 */
export const SECTION_GUIDANCE = {
  reasoning: "Step-by-step chain of thought. Be concise but explicit about assumptions.",
  answer: "The user-facing answer in plain language. Do not invent wearable numbers.",
  uncertainty: "What is unknown, what would change the conclusion, and research caveats.",
} as const;

const GUIDANCE_LINES = new Set<string>(Object.values(SECTION_GUIDANCE));

/** Pure: a section's text without lines that only repeat the prompt's guidance. */
export const withoutGuidanceEcho = (section: string | null): string | null => {
  if (section === null) return null;
  const kept = section
    .split("\n")
    .filter((line) => !GUIDANCE_LINES.has(line.trim()))
    .join("\n")
    .trim();
  return kept === "" ? null : kept;
};

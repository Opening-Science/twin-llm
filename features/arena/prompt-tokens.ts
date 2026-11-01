/**
 * The two menus the prompt bar opens from what is typed (#366), as pure
 * functions so the rules are tested without a browser:
 *
 * - `/` opens the commands, only while the whole prompt is `/` and a word,
 *   as before modes.
 * - `@` opens the sources wherever a word starts with it, at the end of the
 *   prompt: "How did my @oura" asks for sources matching "oura".
 */

export type PromptToken = Readonly<{
  kind: "slash" | "at";
  /** What follows the sign, lower case. */
  query: string;
  /** Where the sign is in the prompt. */
  start: number;
}>;

const SLASH = /^\/([a-z]*)$/i;
const SOURCE_WORD = /^[a-z0-9_-]*$/i;

/** Where the prompt's last word starts: after its last space, tab or newline. */
const lastWordStart = (draft: string): number =>
  Math.max(draft.lastIndexOf(" "), draft.lastIndexOf("\n"), draft.lastIndexOf("\t")) + 1;

export const promptToken = (draft: string): PromptToken | null => {
  const slash = SLASH.exec(draft);
  if (slash !== null) {
    return { kind: "slash", query: (slash[1] ?? "").toLowerCase(), start: 0 };
  }
  const start = lastWordStart(draft);
  const word = draft.slice(start);
  if (!word.startsWith("@") || !SOURCE_WORD.test(word.slice(1))) return null;
  return { kind: "at", query: word.slice(1).toLowerCase(), start };
};

/** The prompt with the `@` word being typed replaced by `@Name `. */
export const withMention = (draft: string, token: PromptToken, name: string): string =>
  `${draft.slice(0, token.start)}@${name.replace(/\s+/g, "")} `;

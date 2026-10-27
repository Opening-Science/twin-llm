/**
 * Addresses other parts of the shell link to. The incognito chat (a separate
 * change) opens a new chat with this flag; until it lands, the flag is ignored
 * and the link opens a normal new chat.
 */
export { INCOGNITO_HREF } from "./incognito";

/** A draft the prompt bar may be opened with: one `/command` and a space, nothing else. */
const DRAFT = /^\/[a-z][a-z0-9-]{0,40} $/;

export const safeDraft = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" && DRAFT.test(value) ? value : undefined;

/** A new chat with `/name ` typed in, for a command or skill; nothing is sent. */
export const draftHref = (name: string): string =>
  `/?draft=${encodeURIComponent(`/${name} `)}`;

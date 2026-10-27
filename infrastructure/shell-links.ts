/**
 * Addresses other parts of the shell link to. The incognito chat (a separate
 * change) opens a new chat with this flag; until it lands, the flag is ignored
 * and the link opens a normal new chat.
 */
export const INCOGNITO_HREF = "/?incognito=1";

/** A draft the prompt bar may be opened with: one `/command` and a space, nothing else. */
const DRAFT = /^\/[a-z][a-z0-9-]{0,40} $/;

export const safeDraft = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" && DRAFT.test(value) ? value : undefined;

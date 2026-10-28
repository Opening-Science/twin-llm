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

/** A synthetic subject_ref as Synthea writes it. */
const SUBJECT_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The start of a question about one cohort subject, from `?subject=`. Only
 * the fixed prefix and the ref go in; the person writes the question, and the
 * chat's scope rules decide whether the subject can be read at all.
 */
export const subjectDraft = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" && SUBJECT_REF.test(value)
    ? `For synthetic subject ${value.toLowerCase()}, `
    : undefined;

/** A new chat with a question about this subject started; nothing is sent. */
export const askAboutSubjectHref = (subjectRef: string): string =>
  `/?subject=${encodeURIComponent(subjectRef)}`;

/** A new chat with `/name ` typed in, for a command or skill; nothing is sent. */
export const draftHref = (name: string): string =>
  `/?draft=${encodeURIComponent(`/${name} `)}`;

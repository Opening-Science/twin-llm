import { z } from "zod";

import type { NotePermit, TwinNoteFields } from "@/infrastructure/twin-notes";

/**
 * What `/compact` does in the chat before anything is sent (#43). Pure, so
 * the incognito and new-chat refusals are tested without a browser.
 */

export const COMPACT_INCOGNITO =
  "Incognito chats are not saved, so /compact makes no note of them.";

export const COMPACT_NO_THREAD =
  "Ask something first. /compact makes a note of a saved thread.";

export type CompactStart =
  | Readonly<{ kind: "refuse"; message: string }>
  | Readonly<{ kind: "draft"; threadId: string }>;

export const compactStartFor = (
  input: Readonly<{ threadId: string | null; incognito: boolean }>,
): CompactStart =>
  input.incognito
    ? { kind: "refuse", message: COMPACT_INCOGNITO }
    : input.threadId === null
      ? { kind: "refuse", message: COMPACT_NO_THREAD }
      : { kind: "draft", threadId: input.threadId };

/** Where a note may go, in the words the draft and Customize · Memory show. */
export const permitLabel = (permit: NotePermit): string =>
  permit === "local"
    ? "Local only: loads only into chats on a model on this machine."
    : permit === "personal"
      ? "Personal: loads only into personal-mode chats, on a provider allowed to see personal data."
      : "Synthetic: loads only into synthetic-mode chats.";

const lines = z.array(z.string());

const responseSchema = z.object({
  draft: z.object({
    title: z.string(),
    topics: lines,
    measures: lines,
    openQuestions: lines,
  }),
  permit: z.enum(["synthetic", "personal", "local"]),
  notice: z.string().optional(),
});

export type CompactDraftResponse = Readonly<{
  draft: TwinNoteFields;
  permit: NotePermit;
  notice?: string;
}>;

/** The draft route's reply, or null when it is not one. */
export const parseCompactResponse = (body: unknown): CompactDraftResponse | null => {
  const parsed = responseSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
};

/** The route's own sentence from an error reply, or the fallback. */
export const errorSentence = (body: unknown, fallback: string): string => {
  const error: unknown = Reflect.get(Object(body), "error");
  return typeof error === "string" ? error : fallback;
};

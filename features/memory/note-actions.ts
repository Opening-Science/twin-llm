"use server";

import { revalidatePath } from "next/cache";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { vaultRefusalForAction } from "@/infrastructure/vault-runtime";
import { ensureAppUser } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import {
  noteAuditEvent,
  noteLineCount,
  splitLines,
  twinNoteFieldsSchema,
} from "@/infrastructure/twin-notes";
import { append } from "@/packages/audit/append";

import { deleteNote, noteExists, setNotesOff, updateNote } from "./note-store";

/**
 * Editing and deleting a twin note, and the switch for loading notes, on
 * Customize · Memory (#43). Only the owner's row is touched. The audit row
 * (`memory.note.edit`, `memory.note.delete`; the note id and a line count) is
 * written first: if it cannot be, nothing changes.
 */

export type NoteFormState = Readonly<{ message: string | null; saved: boolean }>;

const COPY = {
  signIn: "Sign in to keep twin notes.",
  invalid:
    "A note needs a title, and each line may be at most 200 characters. Check the limits under each box.",
  gone: "This note no longer exists.",
  failed: "The change wasn't saved. Try again.",
  saved: "Saved.",
} as const;

const text = (form: FormData, key: string): string => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

const owner = async (): Promise<Readonly<{ actor: string; userId: string }> | null> => {
  const actor = await resolveActorId();
  return actor === null ? null : { actor, userId: (await ensureAppUser(actor)).id };
};

/** The note form as the schema reads it: one item per line. */
const formToNote = (form: FormData) =>
  twinNoteFieldsSchema.safeParse({
    title: text(form, "title"),
    topics: splitLines(text(form, "topics")),
    measures: splitLines(text(form, "measures")),
    openQuestions: splitLines(text(form, "openQuestions")),
  });

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "unknown";

export const editNote = async (
  _previous: NoteFormState,
  form: FormData,
): Promise<NoteFormState> => {
  const locked = await vaultRefusalForAction();
  if (locked !== null) return { message: locked, saved: false };
  const who = await owner();
  if (who === null) return { message: COPY.signIn, saved: false };
  const id = text(form, "id");
  const parsed = formToNote(form);
  if (!parsed.success) return { message: COPY.invalid, saved: false };
  if (!(await noteExists(who.userId, id))) return { message: COPY.gone, saved: false };
  try {
    await append(
      database(),
      noteAuditEvent("edit", {
        actor: who.actor,
        sessionId: id,
        ids: { noteId: id },
        rowCount: noteLineCount(parsed.data),
      }),
    );
    if (!(await updateNote(who.userId, id, parsed.data))) {
      return { message: COPY.gone, saved: false };
    }
  } catch (error) {
    console.error("[memory] could not edit a note", errorName(error));
    return { message: COPY.failed, saved: false };
  }
  revalidatePath("/customize/memory");
  return { message: COPY.saved, saved: true };
};

export const removeNote = async (form: FormData): Promise<void> => {
  if ((await vaultRefusalForAction()) !== null) return;
  const who = await owner();
  const id = text(form, "id");
  if (who === null || id === "" || !(await noteExists(who.userId, id))) return;
  try {
    await append(
      database(),
      noteAuditEvent("delete", {
        actor: who.actor,
        sessionId: id,
        ids: { noteId: id },
        rowCount: 1,
      }),
    );
    await deleteNote(who.userId, id);
  } catch (error) {
    console.error("[memory] could not delete a note", errorName(error));
  }
  revalidatePath("/customize/memory");
};

export const setNotesLoading = async (form: FormData): Promise<void> => {
  if ((await vaultRefusalForAction()) !== null) return;
  const who = await owner();
  if (who === null) return;
  await setNotesOff(who.userId, text(form, "load") !== "on");
  revalidatePath("/customize/memory");
};

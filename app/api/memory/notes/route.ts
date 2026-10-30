import { countNotes, createNote, deleteNote } from "@/features/memory/note-store";
import { createSaveNoteHandler } from "@/features/memory/save-note-handler";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { serverEnv } from "@/infrastructure/env";
import { append } from "@/packages/audit/append";

import { ownedThreadForNote, threadIsLocal } from "../thread-facts";

/** Saves a `/compact` draft the person confirmed (#43); audited as `memory.note.write`. */
export const POST = createSaveNoteHandler({
  resolveActorId,
  findAppUserId,
  loadOwnedThread: ownedThreadForNote,
  threadIsLocal,
  dataMode: () => serverEnv().DATA_MODE,
  countNotes,
  createNote,
  deleteNote,
  appendAudit: (input) => append(database(), input),
  logError: (message, name) => console.error(message, name),
});

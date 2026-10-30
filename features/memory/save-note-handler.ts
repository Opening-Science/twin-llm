import { z } from "zod";

import type { DataMode } from "@/infrastructure/data-mode-policy";
import {
  NOTE_LIMITS,
  noteAuditEvent,
  noteLineCount,
  type NotePermit,
  notePermitFor,
  twinNoteFieldsSchema,
  type TwinNoteFields,
} from "@/infrastructure/twin-notes";
import type { AppendInput } from "@/packages/audit/append";

import type { CompactThread } from "./compact-draft";

/**
 * `POST /api/memory/notes` (#43): saves a draft the person confirmed. The
 * note's data mode and permit come from the server and the thread, never
 * from the browser. The `memory.note.write` row is written right after the
 * row; if it cannot be written the note is deleted again and the person is
 * told it was not saved.
 */

export type NewNote = TwinNoteFields &
  Readonly<{ dataMode: DataMode; permit: NotePermit; sourceThreadId: string }>;

export type SaveNoteDeps = Readonly<{
  resolveActorId: () => Promise<string | null>;
  findAppUserId: (actor: string) => Promise<string | null>;
  loadOwnedThread: (threadId: string) => Promise<CompactThread | null>;
  threadIsLocal: (thread: CompactThread) => Promise<boolean>;
  dataMode: () => DataMode;
  countNotes: (userId: string) => Promise<number>;
  createNote: (userId: string, note: NewNote) => Promise<string>;
  deleteNote: (userId: string, id: string) => Promise<unknown>;
  appendAudit: (input: AppendInput) => Promise<unknown>;
  logError: (message: string, name: string) => void;
}>;

export const SAVE_COPY = {
  signIn: "Sign in to keep twin notes.",
  invalid: `A note needs a title, and at most ${NOTE_LIMITS.topics} topics, ${NOTE_LIMITS.measures} measures and ${NOTE_LIMITS.openQuestions} open questions of ${NOTE_LIMITS.line} characters each.`,
  notFound: "That thread isn't one of yours.",
  limit: `You can keep at most ${NOTE_LIMITS.perPerson} notes; delete one on Customize · Memory first.`,
  failed: "The note wasn't saved. Try again.",
} as const;

const bodySchema = z.object({
  threadId: z.string().min(1).max(64),
  note: twinNoteFieldsSchema,
});

const reply = (status: number, body: Readonly<Record<string, string>>): Response =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "unknown";

export const createSaveNoteHandler =
  (deps: SaveNoteDeps) =>
  async (request: Request): Promise<Response> => {
    const actor = await deps.resolveActorId();
    const userId = actor === null ? null : await deps.findAppUserId(actor);
    if (actor === null || userId === null) return reply(401, { error: SAVE_COPY.signIn });
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return reply(400, { error: SAVE_COPY.invalid });

    const thread = await deps.loadOwnedThread(body.data.threadId);
    if (thread === null) return reply(404, { error: SAVE_COPY.notFound });
    if ((await deps.countNotes(userId)) >= NOTE_LIMITS.perPerson) {
      return reply(409, { error: SAVE_COPY.limit });
    }

    const dataMode = deps.dataMode();
    const permit = notePermitFor({
      dataMode,
      localThread: await deps.threadIsLocal(thread),
    });
    const note = body.data.note;
    const id = await deps
      .createNote(userId, { ...note, dataMode, permit, sourceThreadId: thread.id })
      .catch((error: unknown) => {
        deps.logError("[memory] could not store a note", errorName(error));
        return null;
      });
    if (id === null) return reply(500, { error: SAVE_COPY.failed });

    try {
      await deps.appendAudit(
        noteAuditEvent("write", {
          actor,
          sessionId: thread.id,
          ids: { noteId: id, threadId: thread.id },
          rowCount: noteLineCount(note),
        }),
      );
    } catch (error) {
      deps.logError("[memory] could not audit a note; removing it", errorName(error));
      await deps.deleteNote(userId, id).catch((cleanup: unknown) => {
        deps.logError("[memory] could not remove the unaudited note", errorName(cleanup));
      });
      return reply(500, { error: SAVE_COPY.failed });
    }
    return reply(201, { id });
  };

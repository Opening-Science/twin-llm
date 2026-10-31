import "server-only";

import { database } from "@/infrastructure/database";
import { type FieldCipher, openTexts, sealJson } from "@/infrastructure/field-cipher";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";
import type { DataMode } from "@/infrastructure/data-mode-policy";
import type { NotePermit, TwinNote, TwinNoteFields } from "@/infrastructure/twin-notes";

import type { NewNote } from "./save-note-handler";

/**
 * Where twin notes (#43) are kept. Every read and write filters on the
 * owner; nobody else can list, load, change or delete them. The audit rows
 * are written by the callers, around these calls. Title and lists are sealed
 * with the owner's keys in personal mode (#141).
 */

const TABLE = "twin_notes";

const FIELDS = {
  id: true,
  title: true,
  topics: true,
  measures: true,
  openQuestions: true,
  dataMode: true,
  permit: true,
  createdAt: true,
} as const;

type Row = Readonly<{
  id: string;
  title: string;
  topics: string;
  measures: string;
  openQuestions: string;
  dataMode: string;
  permit: string;
  createdAt: Date;
}>;

const DATA_MODES: readonly DataMode[] = ["synthetic", "personal"];
const PERMITS: readonly NotePermit[] = ["synthetic", "personal", "local"];

/** A stored row as a note; one with an unknown mode or permit is never loaded. */
const toNote = (cipher: FieldCipher, row: Row): TwinNote | null => {
  const dataMode = DATA_MODES.find((mode) => mode === row.dataMode);
  const permit = PERMITS.find((each) => each === row.permit);
  return dataMode === undefined || permit === undefined
    ? null
    : {
        id: row.id,
        title: cipher.openText(TABLE, "title", row.id, row.title),
        topics: openTexts(cipher, TABLE, "topics", row.id, row.topics),
        measures: openTexts(cipher, TABLE, "measures", row.id, row.measures),
        openQuestions: openTexts(
          cipher,
          TABLE,
          "open_questions",
          row.id,
          row.openQuestions,
        ),
        dataMode,
        permit,
        createdAt: row.createdAt.toISOString(),
      };
};

const notes = (cipher: FieldCipher, rows: readonly Row[]): readonly TwinNote[] =>
  rows.flatMap((row) => {
    const note = toNote(cipher, row);
    return note === null ? [] : [note];
  });

const sealedFields = (cipher: FieldCipher, id: string, note: TwinNoteFields) => ({
  title: cipher.sealText(TABLE, "title", id, note.title),
  topics: sealJson(cipher, TABLE, "topics", id, note.topics),
  measures: sealJson(cipher, TABLE, "measures", id, note.measures),
  openQuestions: sealJson(cipher, TABLE, "open_questions", id, note.openQuestions),
});

export const listNotes = async (userId: string): Promise<readonly TwinNote[]> =>
  notes(
    await cipherForUser(userId),
    await database().twinNote.findMany({
      where: { userId },
      select: FIELDS,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  );

export const countNotes = async (userId: string): Promise<number> =>
  database().twinNote.count({ where: { userId } });

export const createNote = async (userId: string, note: NewNote): Promise<string> => {
  const cipher = await cipherForUser(userId);
  const id = crypto.randomUUID();
  return (
    await database().twinNote.create({
      data: {
        id,
        userId,
        ...sealedFields(cipher, id, note),
        dataMode: note.dataMode,
        permit: note.permit,
        sourceThreadId: note.sourceThreadId,
      },
      select: { id: true },
    })
  ).id;
};

/** Changes only the owner's row; false when there is none. Keeps the permit. */
export const updateNote = async (
  userId: string,
  id: string,
  note: TwinNoteFields,
): Promise<boolean> =>
  (
    await database().twinNote.updateMany({
      where: { id, userId },
      data: sealedFields(await cipherForUser(userId), id, note),
    })
  ).count === 1;

export const deleteNote = async (userId: string, id: string): Promise<boolean> =>
  (await database().twinNote.deleteMany({ where: { id, userId } })).count === 1;

export const noteExists = async (userId: string, id: string): Promise<boolean> =>
  (await database().twinNote.count({ where: { id, userId } })) === 1;

/** Whether the person turned loading notes off on Customize · Memory. */
export const notesOff = async (userId: string): Promise<boolean> =>
  (
    await database().onboardingProfile.findUnique({
      where: { userId },
      select: { twinNotesOff: true },
    })
  )?.twinNotesOff ?? false;

export const setNotesOff = async (userId: string, off: boolean): Promise<void> => {
  await database().onboardingProfile.upsert({
    where: { userId },
    create: { userId, twinNotesOff: off },
    update: { twinNotesOff: off },
  });
};

/**
 * The notes a turn of this thread may consider: none when loading is off,
 * else those saved before the thread began, so a new thread starts with them
 * and the thread a note came from does not read it back. The data mode and
 * permit filter is the caller's (`notesForTurn`).
 */
const readNotesBeforeThread = async (
  userId: string,
  turnId: string,
): Promise<readonly TwinNote[]> => {
  if (await notesOff(userId)) return [];
  const turn = await database().turn.findUnique({
    where: { id: turnId },
    select: { thread: { select: { createdAt: true, userId: true } } },
  });
  if (turn === null || turn.thread.userId !== userId) return [];
  return notes(
    await cipherForUser(userId),
    await database().twinNote.findMany({
      where: { userId, createdAt: { lt: turn.thread.createdAt } },
      select: FIELDS,
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  );
};

/**
 * The notes for one chat turn (see above). A database that cannot answer (no table yet)
 * loads no notes rather than failing the turn: leaving notes out sends less.
 */
export const notesBeforeThread = async (
  userId: string,
  turnId: string,
): Promise<readonly TwinNote[]> => {
  try {
    return await readNotesBeforeThread(userId, turnId);
  } catch (error) {
    console.error(
      "[memory] notes unreadable; the turn runs without them",
      error instanceof Error ? error.name : "unknown",
    );
    return [];
  }
};

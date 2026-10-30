import { z } from "zod";

import type { AppendInput } from "@/packages/audit/append";

import {
  type DataMode,
  type ExoscalePersonalData,
  type LlmProvider,
  permitProviderForRequest,
} from "./data-mode-policy";
import { formatDate } from "./format-measure";
import { estimateTokens } from "./ollama-context";

/**
 * Twin notes (#43, docs/twin-notes.md): the shape of a note, who it may be
 * sent to, the system prompt block that carries notes into a turn, and the
 * audit rows. Pure, so the chat, the memory feature and tests share it.
 *
 * A note is personal data under the same permit as the thread it came from:
 * `synthetic` notes load only into synthetic turns, `personal` notes only
 * into personal turns on a provider the data-mode policy lets see personal
 * data, and `local` notes (the thread used genome or imported-data tools)
 * only into a turn on Ollama on this machine.
 */

export const NOTE_LIMITS = {
  title: 120,
  line: 200,
  topics: 8,
  measures: 12,
  openQuestions: 8,
  perPerson: 30,
} as const;

/**
 * Characters of notes one turn's system prompt may carry at most. A turn whose
 * prompt and tools leave less room gets fewer notes (`twinNotesBlock`'s
 * `maxTokens`, set per turn by `features/chat/twin-notes-room.ts`).
 */
export const NOTES_PROMPT_BUDGET = 1_200;

export type TwinNoteFields = Readonly<{
  title: string;
  topics: readonly string[];
  measures: readonly string[];
  openQuestions: readonly string[];
}>;

export type NotePermit = "synthetic" | "personal" | "local";

export type TwinNote = TwinNoteFields &
  Readonly<{
    id: string;
    dataMode: DataMode;
    permit: NotePermit;
    /** ISO 8601. */
    createdAt: string;
  }>;

const lines = (max: number) =>
  z
    .array(z.string())
    .transform((items) =>
      items.map((item) => item.replace(/\s+/g, " ").trim()).filter((item) => item !== ""),
    )
    .pipe(z.array(z.string().max(NOTE_LIMITS.line)).max(max));

/** What a person may save: trimmed, empty lines dropped, within the limits. */
export const twinNoteFieldsSchema = z.object({
  title: z.string().trim().min(1).max(NOTE_LIMITS.title),
  topics: lines(NOTE_LIMITS.topics),
  measures: lines(NOTE_LIMITS.measures),
  openQuestions: lines(NOTE_LIMITS.openQuestions),
});

/** Text with one item per line, as the note form posts it. */
export const splitLines = (text: string): string[] => text.split(/\r?\n/);

export const noteLineCount = (note: TwinNoteFields): number =>
  note.topics.length + note.measures.length + note.openQuestions.length;

// ─── Permit ────────────────────────────────────────────────────────────────

export type ThreadFacts = Readonly<{
  dataMode: DataMode;
  /** The thread used a genome or imported-data tool (local-only data). */
  localThread: boolean;
}>;

export const notePermitFor = (thread: ThreadFacts): NotePermit =>
  thread.localThread
    ? "local"
    : thread.dataMode === "personal"
      ? "personal"
      : "synthetic";

export type NoteTurn = Readonly<{
  mode: DataMode;
  provider: LlmProvider;
  exoscalePersonalData: ExoscalePersonalData;
  /** The chat model runs on this machine (Ollama on loopback). */
  chatIsLocal: boolean;
}>;

const localModel = (turn: NoteTurn): boolean =>
  turn.provider === "ollama" && turn.chatIsLocal;

/** Whether data under this permit may go to the turn's model. */
export const permitAllows = (permit: NotePermit, turn: NoteTurn): boolean =>
  permit === "local"
    ? localModel(turn)
    : permit === "personal"
      ? permitProviderForRequest({
          mode: "personal",
          provider: turn.provider,
          hasWearableNarrative: false,
          exoscalePersonalData: turn.exoscalePersonalData,
        }).ok
      : true;

/** A note loads only into a turn of its own data mode, on a model its permit allows. */
export const noteMayLoad = (
  note: Pick<TwinNote, "dataMode" | "permit">,
  turn: NoteTurn,
): boolean => note.dataMode === turn.mode && permitAllows(note.permit, turn);

export const NOTE_DRAFT_REFUSED =
  "This thread's model may not see this thread's data, so no note was drafted.";

/** May the thread's model draft a note of this thread? The thread's own permit decides. */
export const permitNoteDraft = (
  thread: ThreadFacts,
  turn: NoteTurn,
): Readonly<{ ok: true }> | Readonly<{ ok: false; sentence: string }> =>
  permitAllows(notePermitFor(thread), turn)
    ? { ok: true }
    : { ok: false, sentence: NOTE_DRAFT_REFUSED };

// ─── Prompt block ──────────────────────────────────────────────────────────

export const NOTES_HEADING =
  "## Twin notes (written and confirmed by the person; not records)";
export const NOTES_OPEN = "<<<twin-notes";
export const NOTES_CLOSE = "twin-notes>>>";
export const NOTES_RULE =
  "Use these notes as background on what the person asked before. They hold no readings; read values with the tools.";

/** The delimiters must never appear inside a note. */
const unfenced = (text: string): string => text.replace(/<<<|>>>/g, "");

const joined = (items: readonly string[]): string =>
  items.length === 0 ? "none" : items.map(unfenced).join("; ");

export const noteText = (note: TwinNote): string =>
  [
    `### ${unfenced(note.title)} (${formatDate(note.createdAt.slice(0, 10))})`,
    `Topics: ${joined(note.topics)}`,
    `Measures: ${joined(note.measures)}`,
    `Open questions: ${joined(note.openQuestions)}`,
  ].join("\n");

export type NotesBlock = Readonly<{ text: string; ids: readonly string[] }>;

const blockText = (texts: readonly string[]): string =>
  [NOTES_HEADING, NOTES_OPEN, ...texts, NOTES_CLOSE, NOTES_RULE].join("\n");

/**
 * Newest notes first, as many whole notes as fit both the character budget
 * and `maxTokens`, the estimated tokens the whole block (heading and rule
 * included) may take in the prompt. Empty text and no ids when none fits or
 * there are none.
 */
export const twinNotesBlock = (
  notes: readonly TwinNote[],
  budget: number = NOTES_PROMPT_BUDGET,
  maxTokens: number = Number.POSITIVE_INFINITY,
): NotesBlock => {
  const newest = [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const kept = newest.reduce<{ texts: string[]; ids: string[]; used: number }>(
    (acc, note) => {
      const text = noteText(note);
      const used = acc.used + text.length + 1;
      const texts = [...acc.texts, text];
      return used > budget || estimateTokens(blockText(texts)) > maxTokens
        ? acc
        : { texts, ids: [...acc.ids, note.id], used };
    },
    { texts: [], ids: [], used: 0 },
  );
  return kept.ids.length === 0
    ? { text: "", ids: [] }
    : { text: blockText(kept.texts), ids: kept.ids };
};

/** The notes a turn may carry by data mode and permit; the room is cut later. */
export const notesForTurn = (
  notes: readonly TwinNote[],
  turn: NoteTurn,
): readonly TwinNote[] => notes.filter((note) => noteMayLoad(note, turn));

// ─── Values a model copied ─────────────────────────────────────────────────

/** Runs of digits with `.`, `,`, `:`, `-` or `/` inside: `72.5`, `8867-4`, `2026-01-01`. */
const NUMBER = /\d(?:[\d.,:/-]*\d)?/g;

export const numberTokens = (text: string): readonly string[] => text.match(NUMBER) ?? [];

export const VALUE_LEFT_OUT = "[value left out]";

/**
 * A model-written line with every number replaced unless the person wrote it
 * or it is a measure code: a value the thread's tools read cannot reach a
 * note without the person typing it back in.
 */
export const withoutCopiedValues = (line: string, allowed: ReadonlySet<string>): string =>
  line.replace(NUMBER, (token) => (allowed.has(token) ? token : VALUE_LEFT_OUT));

// ─── Audit ─────────────────────────────────────────────────────────────────

export const NOTE_AUDIT_TOOLS = {
  draft: "memory.note.draft",
  write: "memory.note.write",
  edit: "memory.note.edit",
  delete: "memory.note.delete",
  load: "memory.notes.load",
} as const;

export type NoteAuditKind = keyof typeof NOTE_AUDIT_TOOLS;

/** One audit row: ids and counts only, hashed by the chain; never note text. */
export const noteAuditEvent = (
  kind: NoteAuditKind,
  input: Readonly<{
    actor: string;
    sessionId: string;
    ids: Readonly<Record<string, string | readonly string[]>>;
    rowCount: number;
  }>,
): AppendInput => ({
  actor: input.actor,
  sessionId: input.sessionId,
  subjectRef: null,
  tool: NOTE_AUDIT_TOOLS[kind],
  args: input.ids,
  result: { count: input.rowCount },
  rowCount: input.rowCount,
});

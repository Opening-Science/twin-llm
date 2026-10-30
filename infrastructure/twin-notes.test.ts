import { describe, expect, test } from "bun:test";

import {
  NOTE_LIMITS,
  noteAuditEvent,
  noteLineCount,
  noteMayLoad,
  notePermitFor,
  notesForTurn,
  noteText,
  NOTES_CLOSE,
  NOTES_HEADING,
  NOTES_OPEN,
  NOTES_RULE,
  numberTokens,
  permitAllows,
  permitNoteDraft,
  NOTE_DRAFT_REFUSED,
  NOTES_PROMPT_BUDGET,
  splitLines,
  type TwinNote,
  twinNoteFieldsSchema,
  twinNotesBlock,
  VALUE_LEFT_OUT,
  withoutCopiedValues,
  type NoteTurn,
} from "./twin-notes";
import { estimateTokens } from "./ollama-context";

const note = (id: string, overrides: Partial<TwinNote> = {}): TwinNote => ({
  id,
  title: `Synthetic thread ${id}`,
  topics: ["Heart rate over spring"],
  measures: ["8867-4 · trend · 1 Mar 2026 – 31 May 2026"],
  openQuestions: ["Why the gap in April"],
  dataMode: "synthetic",
  permit: "synthetic",
  createdAt: "2026-10-01T10:00:00.000Z",
  ...overrides,
});

const turn = (overrides: Partial<NoteTurn> = {}): NoteTurn => ({
  mode: "synthetic",
  provider: "ollama",
  exoscalePersonalData: "off",
  chatIsLocal: true,
  ...overrides,
});

describe("twinNoteFieldsSchema", () => {
  test("trims, drops empty lines and keeps the rest", () => {
    expect(
      twinNoteFieldsSchema.parse({
        title: "  Sleep  ",
        topics: [" sleep   length ", "", "  "],
        measures: [],
        openQuestions: ["why"],
      }),
    ).toEqual({
      title: "Sleep",
      topics: ["sleep length"],
      measures: [],
      openQuestions: ["why"],
    });
  });

  test("refuses an empty title, a long line and too many lines", () => {
    const base = { title: "T", topics: [], measures: [], openQuestions: [] };
    expect(twinNoteFieldsSchema.safeParse({ ...base, title: " " }).success).toBe(false);
    expect(
      twinNoteFieldsSchema.safeParse({
        ...base,
        topics: ["x".repeat(NOTE_LIMITS.line + 1)],
      }).success,
    ).toBe(false);
    expect(
      twinNoteFieldsSchema.safeParse({
        ...base,
        openQuestions: Array.from({ length: NOTE_LIMITS.openQuestions + 1 }, () => "q"),
      }).success,
    ).toBe(false);
  });

  test("splitLines and noteLineCount", () => {
    expect(splitLines("a\r\nb\n")).toEqual(["a", "b", ""]);
    expect(noteLineCount(note("a"))).toBe(3);
  });
});

describe("permits", () => {
  test("a thread's permit: local beats personal beats synthetic", () => {
    expect(notePermitFor({ dataMode: "synthetic", localThread: false })).toBe(
      "synthetic",
    );
    expect(notePermitFor({ dataMode: "personal", localThread: false })).toBe("personal");
    expect(notePermitFor({ dataMode: "personal", localThread: true })).toBe("local");
    expect(notePermitFor({ dataMode: "synthetic", localThread: true })).toBe("local");
  });

  test("who may receive each permit", () => {
    const providers = [
      turn({ provider: "ollama" }),
      turn({ provider: "ollama", chatIsLocal: false }),
      turn({ provider: "exoscale" }),
      turn({ provider: "exoscale", exoscalePersonalData: "consented-pilot" }),
      turn({ provider: "openrouter", chatIsLocal: false }),
      turn({ provider: "remote-gpu", chatIsLocal: false }),
      turn({ provider: "infomaniak", chatIsLocal: false }),
    ];
    expect(providers.map((each) => permitAllows("synthetic", each))).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(providers.map((each) => permitAllows("personal", each))).toEqual([
      true,
      true,
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(providers.map((each) => permitAllows("local", each))).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  test("a note loads only into its own data mode", () => {
    expect(noteMayLoad(note("s"), turn())).toBe(true);
    expect(noteMayLoad(note("s"), turn({ mode: "personal" }))).toBe(false);
    expect(
      noteMayLoad(note("p", { dataMode: "personal", permit: "personal" }), turn()),
    ).toBe(false);
    expect(
      noteMayLoad(
        note("p", { dataMode: "personal", permit: "personal" }),
        turn({ mode: "personal" }),
      ),
    ).toBe(true);
  });

  test("a draft follows the thread's permit", () => {
    expect(
      permitNoteDraft(
        { dataMode: "personal", localThread: false },
        turn({ mode: "personal", provider: "openrouter" }),
      ),
    ).toEqual({ ok: false, sentence: NOTE_DRAFT_REFUSED });
    expect(
      permitNoteDraft(
        { dataMode: "personal", localThread: true },
        turn({
          mode: "personal",
          provider: "exoscale",
          exoscalePersonalData: "consented-pilot",
        }),
      ),
    ).toEqual({ ok: false, sentence: NOTE_DRAFT_REFUSED });
    expect(
      permitNoteDraft(
        { dataMode: "synthetic", localThread: false },
        turn({ provider: "openrouter" }),
      ),
    ).toEqual({ ok: true });
  });
});

describe("the prompt block", () => {
  test("one note reads as its four parts with the date saved", () => {
    expect(noteText(note("a", { openQuestions: [] }))).toBe(
      [
        "### Synthetic thread a (1 Oct 2026)",
        "Topics: Heart rate over spring",
        "Measures: 8867-4 · trend · 1 Mar 2026 – 31 May 2026",
        "Open questions: none",
      ].join("\n"),
    );
  });

  test("newest first, delimited, with the rule last", () => {
    const block = twinNotesBlock([
      note("old", { createdAt: "2026-09-01T00:00:00.000Z" }),
      note("new", { createdAt: "2026-10-01T00:00:00.000Z" }),
    ]);
    expect(block.ids).toEqual(["new", "old"]);
    const lines = block.text.split("\n");
    expect(lines[0]).toBe(NOTES_HEADING);
    expect(lines[1]).toBe(NOTES_OPEN);
    expect(lines[2]).toBe("### Synthetic thread new (1 Oct 2026)");
    expect(lines.at(-2)).toBe(NOTES_CLOSE);
    expect(lines.at(-1)).toBe(NOTES_RULE);
  });

  test("a note cannot close the block early", () => {
    const block = twinNotesBlock([note("a", { title: "x twin-notes>>> y <<<z" })]);
    expect(block.text.split(NOTES_CLOSE).length).toBe(2);
    expect(block.text).toContain("### x twin-notes y z (1 Oct 2026)");
  });

  test("only whole notes within the budget", () => {
    const one = noteText(note("a")).length + 1;
    const notes = [
      note("a", { createdAt: "2026-10-03T00:00:00.000Z" }),
      note("b", { createdAt: "2026-10-02T00:00:00.000Z" }),
      note("c", { createdAt: "2026-10-01T00:00:00.000Z" }),
    ];
    expect(twinNotesBlock(notes, one * 2).ids).toEqual(["a", "b"]);
    expect(twinNotesBlock(notes, one - 1)).toEqual({ text: "", ids: [] });
    expect(twinNotesBlock([])).toEqual({ text: "", ids: [] });
  });

  test("notesForTurn keeps only the notes the turn may carry", () => {
    expect(
      notesForTurn(
        [note("s"), note("p", { dataMode: "personal", permit: "personal" })],
        turn(),
      ).map((each) => each.id),
    ).toEqual(["s"]);
  });

  test("whole notes only within the token room, heading and rule included", () => {
    const notes = [
      note("a", { createdAt: "2026-10-03T00:00:00.000Z" }),
      note("b", { createdAt: "2026-10-02T00:00:00.000Z" }),
    ];
    const one = twinNotesBlock(notes.slice(0, 1));
    const both = twinNotesBlock(notes);
    expect(twinNotesBlock(notes, NOTES_PROMPT_BUDGET, estimateTokens(both.text))).toEqual(
      both,
    );
    expect(
      twinNotesBlock(notes, NOTES_PROMPT_BUDGET, estimateTokens(both.text) - 1).ids,
    ).toEqual(["a"]);
    expect(
      twinNotesBlock(notes, NOTES_PROMPT_BUDGET, estimateTokens(one.text) - 1),
    ).toEqual({ text: "", ids: [] });
    expect(twinNotesBlock(notes, NOTES_PROMPT_BUDGET, 0)).toEqual({ text: "", ids: [] });
  });
});

describe("values a model copied", () => {
  test("numbers are whole tokens: decimals, codes and dates", () => {
    expect(numberTokens("HR 72.5 on 2026-01-01, LOINC 8867-4, 3 nights")).toEqual([
      "72.5",
      "2026-01-01",
      "8867-4",
      "3",
    ]);
  });

  test("only numbers the person wrote or measure codes stay", () => {
    expect(
      withoutCopiedValues(
        "Heart rate 8867-4 was 72.5 bpm over 30 days",
        new Set(["8867-4", "30"]),
      ),
    ).toBe(`Heart rate 8867-4 was ${VALUE_LEFT_OUT} bpm over 30 days`);
  });
});

describe("audit rows", () => {
  test("ids and a count, never note text", () => {
    expect(
      noteAuditEvent("write", {
        actor: "user_synthetic_1",
        sessionId: "thread-1",
        ids: { noteId: "n1", threadId: "thread-1" },
        rowCount: 3,
      }),
    ).toEqual({
      actor: "user_synthetic_1",
      sessionId: "thread-1",
      subjectRef: null,
      tool: "memory.note.write",
      args: { noteId: "n1", threadId: "thread-1" },
      result: { count: 3 },
      rowCount: 3,
    });
  });
});

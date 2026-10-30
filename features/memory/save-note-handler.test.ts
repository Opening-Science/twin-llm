import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";

import { SYNTHETIC_THREAD } from "./fixtures";
import {
  createSaveNoteHandler,
  type NewNote,
  SAVE_COPY,
  type SaveNoteDeps,
} from "./save-note-handler";

const ACTOR = "user_synthetic_1";
const USER = "app-user-synthetic-1";

const NOTE = {
  title: "Heart rate in spring",
  topics: ["Heart rate over spring", ""],
  measures: ["8867-4 · trend · 1 Mar 2026 – 31 May 2026"],
  openQuestions: [],
};

const request = (body: unknown): Request =>
  new Request("http://localhost/api/memory/notes", {
    method: "POST",
    body: JSON.stringify(body),
  });

const harness = (
  overrides: Partial<SaveNoteDeps> &
    Readonly<{ auditFails?: boolean; count?: number }> = {},
) => {
  const created: NewNote[] = [];
  const deleted: string[] = [];
  const audits: AppendInput[] = [];
  const deps: SaveNoteDeps = {
    resolveActorId: async () => ACTOR,
    findAppUserId: async () => USER,
    loadOwnedThread: async (id) => (id === SYNTHETIC_THREAD.id ? SYNTHETIC_THREAD : null),
    threadIsLocal: async () => false,
    dataMode: () => "synthetic",
    countNotes: async () => overrides.count ?? 0,
    createNote: async (_user, note) => {
      created.push(note);
      return "note-1";
    },
    deleteNote: async (_user, id) => {
      deleted.push(id);
    },
    appendAudit: async (input) => {
      if (overrides.auditFails) throw new Error("audit down");
      audits.push(input);
      return {};
    },
    logError: () => undefined,
    ...overrides,
  };
  return { handle: createSaveNoteHandler(deps), created, deleted, audits };
};

describe("POST /api/memory/notes", () => {
  test("saves what the person confirmed with the server's mode and permit", async () => {
    const { handle, created, audits } = harness();
    const response = await handle(
      request({
        threadId: SYNTHETIC_THREAD.id,
        note: NOTE,
        permit: "synthetic",
        dataMode: "personal",
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "note-1" });
    expect(created).toEqual([
      {
        title: "Heart rate in spring",
        topics: ["Heart rate over spring"],
        measures: ["8867-4 · trend · 1 Mar 2026 – 31 May 2026"],
        openQuestions: [],
        dataMode: "synthetic",
        permit: "synthetic",
        sourceThreadId: SYNTHETIC_THREAD.id,
      },
    ]);
    expect(audits.map((row) => [row.tool, row.args, row.rowCount])).toEqual([
      ["memory.note.write", { noteId: "note-1", threadId: SYNTHETIC_THREAD.id }, 2],
    ]);
  });

  test("a genome or imported-data thread's note is local only", async () => {
    const { handle, created } = harness({
      threadIsLocal: async () => true,
      dataMode: () => "personal",
    });
    await handle(request({ threadId: SYNTHETIC_THREAD.id, note: NOTE }));
    expect(created.map((note) => [note.dataMode, note.permit])).toEqual([
      ["personal", "local"],
    ]);
  });

  test("refusals: signed out, invalid, someone else's thread, over the limit", async () => {
    expect(
      (await harness({ resolveActorId: async () => null }).handle(request({}))).status,
    ).toBe(401);

    const invalid = harness();
    const bad = await invalid.handle(
      request({ threadId: SYNTHETIC_THREAD.id, note: { ...NOTE, title: "" } }),
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: SAVE_COPY.invalid });

    const other = harness();
    expect(
      (await other.handle(request({ threadId: "thread-other", note: NOTE }))).status,
    ).toBe(404);
    expect(other.created).toEqual([]);

    const full = harness({ count: 30 });
    const limited = await full.handle(
      request({ threadId: SYNTHETIC_THREAD.id, note: NOTE }),
    );
    expect(limited.status).toBe(409);
    expect(full.created).toEqual([]);
  });

  test("a note whose audit row cannot be written is removed again", async () => {
    const { handle, deleted } = harness({ auditFails: true });
    const response = await handle(request({ threadId: SYNTHETIC_THREAD.id, note: NOTE }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: SAVE_COPY.failed });
    expect(deleted).toEqual(["note-1"]);
  });
});

import { describe, expect, test } from "bun:test";

import {
  COMPACT_INCOGNITO,
  COMPACT_NO_THREAD,
  compactStartFor,
  errorSentence,
  parseCompactResponse,
  permitLabel,
} from "./compact-state";

describe("compactStartFor", () => {
  test("incognito never drafts, even with a thread id", () => {
    expect(compactStartFor({ threadId: "thread-1", incognito: true })).toEqual({
      kind: "refuse",
      message: COMPACT_INCOGNITO,
    });
  });

  test("a new chat has nothing to draft; a saved one does", () => {
    expect(compactStartFor({ threadId: null, incognito: false })).toEqual({
      kind: "refuse",
      message: COMPACT_NO_THREAD,
    });
    expect(compactStartFor({ threadId: "thread-1", incognito: false })).toEqual({
      kind: "draft",
      threadId: "thread-1",
    });
  });
});

describe("the draft reply", () => {
  test("parses a draft and refuses anything else", () => {
    const draft = { title: "T", topics: ["a"], measures: [], openQuestions: [] };
    expect(parseCompactResponse({ draft, permit: "local" })).toEqual({
      draft,
      permit: "local",
    });
    expect(parseCompactResponse({ draft, permit: "everyone" })).toBeNull();
    expect(parseCompactResponse(null)).toBeNull();
  });

  test("errorSentence takes the route's sentence or the fallback", () => {
    expect(errorSentence({ error: "No." }, "Fallback")).toBe("No.");
    expect(errorSentence({ error: 3 }, "Fallback")).toBe("Fallback");
    expect(errorSentence(null, "Fallback")).toBe("Fallback");
  });

  test("permit labels", () => {
    expect(permitLabel("synthetic")).toBe(
      "Synthetic: loads only into synthetic-mode chats.",
    );
    expect(permitLabel("local")).toBe(
      "Local only: loads only into chats on a model on this machine.",
    );
  });
});

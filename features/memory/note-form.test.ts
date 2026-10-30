import { describe, expect, test } from "bun:test";

import { noteFromForm } from "./note-form";

describe("noteFromForm", () => {
  test("one item per line, blanks dropped, title trimmed", () => {
    const form = new FormData();
    form.set("title", "  Heart rate  ");
    form.set("topics", "Heart rate\r\n\n  Sleep  ");
    form.set("measures", "8867-4 · trend · no date range");
    expect(noteFromForm(form)).toEqual({
      title: "Heart rate",
      topics: ["Heart rate", "Sleep"],
      measures: ["8867-4 · trend · no date range"],
      openQuestions: [],
    });
  });
});

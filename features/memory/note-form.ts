import { splitLines, type TwinNoteFields } from "@/infrastructure/twin-notes";

/** The note a form holds, one item per line, as the save route takes it. */
export const noteFromForm = (form: FormData): TwinNoteFields => {
  const text = (key: string): string => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  const lines = (key: string): string[] =>
    splitLines(text(key))
      .map((line) => line.trim())
      .filter((line) => line !== "");
  return {
    title: text("title").trim(),
    topics: lines("topics"),
    measures: lines("measures"),
    openQuestions: lines("openQuestions"),
  };
};

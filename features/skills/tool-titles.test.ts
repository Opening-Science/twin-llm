import { describe, expect, test } from "bun:test";

import {
  hasToolTitle,
  toolDoes,
  toolTitle,
  toolWords,
} from "@/infrastructure/tool-titles";

import { CHAT_TOOL_NAMES } from "./skill-schema";

const firstWord = (text: string): string => text.split(" ")[0] ?? "";

/**
 * The palette, a skill's page and an agent's page list a skill's tools in
 * words (#480), saying what each does before it runs; the answer titles each
 * call with the step it took (#503). Every tool a skill may list has both.
 */
describe("tool titles", () => {
  test("every tool a skill may list has a written title", () => {
    expect(CHAT_TOOL_NAMES.filter((tool) => !hasToolTitle(tool))).toEqual([]);
  });

  test("every tool has a step title and a present-tense line, from one entry", () => {
    const missing = CHAT_TOOL_NAMES.filter((tool) => {
      const words = toolWords(tool);
      return !words || words.done.trim() === "" || words.does.trim() === "";
    });
    expect(missing).toEqual([]);
    expect(toolTitle("coverage")).toBe("Checked data coverage");
    expect(toolDoes("coverage")).toBe("checks data coverage");
  });

  test("the present-tense line never starts with the step title's past-tense verb", () => {
    const pastTense = CHAT_TOOL_NAMES.filter(
      (tool) =>
        firstWord(toolDoes(tool)).toLowerCase() ===
        firstWord(toolTitle(tool)).toLowerCase(),
    );
    expect(pastTense).toEqual([]);
  });

  test("an unknown tool is spelled out in both tenses, never shown raw", () => {
    expect(toolTitle("some_new_tool")).toBe("Some new tool");
    expect(toolDoes("some_new_tool")).toBe("some new tool");
    expect(toolDoes("_")).toBe("a tool");
  });

  test("an object's own keys are not tool titles", () => {
    expect(hasToolTitle("toString")).toBe(false);
    expect(toolTitle("constructor")).toBe("Constructor");
    expect(toolDoes("constructor")).toBe("constructor");
  });

  test("a title never shows a tool id written with underscores", () => {
    expect(
      CHAT_TOOL_NAMES.filter((tool) =>
        `${toolTitle(tool)} ${toolDoes(tool)}`.includes("_"),
      ),
    ).toEqual([]);
    expect(toolTitle("genome_variants")).toBe(
      "Looked up named variants in your imported genome file",
    );
  });
});

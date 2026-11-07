import { describe, expect, test } from "bun:test";

import { hasToolTitle, toolTitle } from "@/infrastructure/tool-titles";

import { CHAT_TOOL_NAMES } from "./skill-schema";

/**
 * The palette, a skill's page and an agent's page list a skill's tools in
 * words (#480). Every tool a skill may list has a written title, so none
 * falls back to its id spelled out.
 */
describe("tool titles", () => {
  test("every tool a skill may list has a written title", () => {
    expect(CHAT_TOOL_NAMES.filter((tool) => !hasToolTitle(tool))).toEqual([]);
  });

  test("a title never shows a tool id written with underscores", () => {
    expect(CHAT_TOOL_NAMES.filter((tool) => toolTitle(tool).includes("_"))).toEqual([]);
    expect(toolTitle("genome_variants")).toBe(
      "Looked up named variants in your imported genome file",
    );
  });
});

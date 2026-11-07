import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { TurnSkill } from "@/infrastructure/skill-gate";
import { TOOLS_IN_WORDS, toolDoes, toolTitle } from "@/infrastructure/tool-titles";

import { SkillDetail } from "./skill-detail";

const ANATOMY: TurnSkill = {
  name: "anatomy",
  description: "Explain where organs and body systems are.",
  tools: ["knowledge_search"],
  sources: ["opentwin-knowledge"],
  providers: ["ollama"],
  views: ["twin.body"],
  instructions: "Explain.",
};

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ");

/** A skill's page in words (#480): what it reads and may use, no tool ids. */
describe("SkillDetail", () => {
  test("names its tools in words and reads only its own sources", () => {
    const shown = text(
      renderToStaticMarkup(createElement(SkillDetail, { skill: ANATOMY })),
    );
    expect(shown).toContain(
      "Reads OpenTwin knowledge notes May use searches TwinLLM notes Model",
    );
    expect(shown).not.toContain("knowledge_search");
    expect(shown).not.toContain("wearables");
  });

  test("says what every tool does, never a step an answer took (#503)", () => {
    const shown = text(
      renderToStaticMarkup(
        createElement(SkillDetail, { skill: { ...ANATOMY, tools: TOOLS_IN_WORDS } }),
      ),
    );
    expect(shown).toContain(`May use ${TOOLS_IN_WORDS.map(toolDoes).join(", ")} Model`);
    expect(TOOLS_IN_WORDS.filter((tool) => shown.includes(toolTitle(tool)))).toEqual([]);
  });
});

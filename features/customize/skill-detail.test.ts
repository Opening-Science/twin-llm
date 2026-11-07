import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { TurnSkill } from "@/infrastructure/skill-gate";

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

const text = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/** A skill's page in words (#480): what it reads and may use, no tool ids. */
describe("SkillDetail", () => {
  test("names its tools in words and reads only its own sources", () => {
    const shown = text(
      renderToStaticMarkup(createElement(SkillDetail, { skill: ANATOMY })),
    );
    expect(shown).toContain(
      "Reads OpenTwin knowledge notes May use Searched TwinLLM notes Model",
    );
    expect(shown).not.toContain("knowledge_search");
    expect(shown).not.toContain("wearables");
  });
});

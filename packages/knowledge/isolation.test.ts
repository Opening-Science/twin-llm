import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createKnowledgeTools, knowledgeToolDescription } from "./ai-tools";

const read = (path: string): string => readFileSync(join(import.meta.dir, path), "utf8");

describe("knowledge tool isolation", () => {
  test("createKnowledgeTools returns knowledge_search only, in both DATA_MODE values", () => {
    const synthetic = createKnowledgeTools({
      actor: "a",
      sessionId: "s-syn",
      mode: "synthetic",
    });
    const personal = createKnowledgeTools({
      actor: "a",
      sessionId: "s-per",
      mode: "personal",
    });
    expect(Object.keys(synthetic)).toEqual(["knowledge_search"]);
    expect(Object.keys(personal)).toEqual(["knowledge_search"]);
  });

  test("chat wiring adds the tool and drains its citations into the document", () => {
    const chatTools = read("../../features/chat/chat-tools.ts");
    // The drain lives in the turn the route and the eval harness share.
    const turn = read("../../features/chat/run-twin-turn.ts");
    expect(chatTools).toContain("knowledge: createKnowledgeTools,");
    expect(chatTools).toContain(
      "make.knowledge(scope, undefined, literatureSourcesForAgent(options?.agent))",
    );
    expect(turn).toContain("drainKnowledgeTurn(turnId)");
    expect(turn).toContain("knowledgeSources: knowledge.sources");
  });

  test("search reads the knowledge source and an agent's literature, never guideline rows", () => {
    expect(read("search.ts")).toContain(
      "ports.search(embedding, input.k, [KNOWLEDGE_SOURCE])",
    );
    expect(read("search.ts")).not.toContain("GUIDELINE_SOURCE");
  });

  test("the tool text names the literature only on an agent's turn", () => {
    expect(knowledgeToolDescription([])).not.toContain("PubMed Central");
    expect(knowledgeToolDescription(["literature:diet"])).toBe(
      knowledgeToolDescription([]) +
        " Also searches open-access articles from PubMed Central for this agent's " +
        "specialty: each such hit gives the article title, PMC id and licence. Quote " +
        "an article only word for word with its attribution line; it is reference " +
        "material, never evidence about this person.",
    );
  });
});

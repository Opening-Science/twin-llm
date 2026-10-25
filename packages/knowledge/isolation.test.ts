import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createKnowledgeTools } from "./ai-tools";

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
    expect(chatTools).toContain("createKnowledgeTools(scope)");
    expect(turn).toContain("drainKnowledgeTurn(turnId)");
    expect(turn).toContain("knowledgeSources: knowledge.sources");
  });

  test("search reads only the knowledge source, never guideline rows", () => {
    expect(read("search.ts")).toContain(
      "queryNearestChunks(database(), embedding, k, KNOWLEDGE_SOURCE)",
    );
  });
});

import { describe, expect, test } from "bun:test";

import { createChatTools } from "./chat-tools";

const scope = { actor: "a", sessionId: "turn-1", mode: "synthetic" } as const;
const liveNames = (tools: Readonly<Record<string, unknown>>): string[] =>
  Object.keys(tools).filter(
    (name) => name === "pubmed_search" || name === "ensembl_lookup",
  );

describe("live public lookups in the chat tools (#6)", () => {
  test("off by default: no switch, no live tool", () => {
    expect(liveNames(createChatTools(scope))).toEqual([]);
    expect(
      liveNames(
        createChatTools(scope, {
          live: { enabled: [], incognito: false, genomeInTurn: false },
        }),
      ),
    ).toEqual([]);
  });

  test("a switched-on source is offered", () => {
    expect(
      liveNames(
        createChatTools(scope, {
          live: { enabled: ["pubmed", "ensembl"], incognito: false, genomeInTurn: false },
        }),
      ),
    ).toEqual(["pubmed_search", "ensembl_lookup"]);
  });

  test("an incognito chat is never offered one", () => {
    expect(
      liveNames(
        createChatTools(scope, {
          live: { enabled: ["pubmed", "ensembl"], incognito: true, genomeInTurn: false },
        }),
      ),
    ).toEqual([]);
  });
});

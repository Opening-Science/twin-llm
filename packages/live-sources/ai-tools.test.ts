import { describe, expect, test } from "bun:test";

import { createLiveSourceTools } from "./ai-tools";

const scope = { actor: "a", sessionId: "s", mode: "synthetic" } as const;
const turn = { incognito: false, genomeInTurn: false };

describe("createLiveSourceTools", () => {
  test("only the sources the person switched on become tools", () => {
    expect(Object.keys(createLiveSourceTools(scope, { ...turn, enabled: [] }))).toEqual(
      [],
    );
    expect(
      Object.keys(createLiveSourceTools(scope, { ...turn, enabled: ["ensembl"] })),
    ).toEqual(["ensembl_lookup"]);
    expect(
      Object.keys(
        createLiveSourceTools(scope, { ...turn, enabled: ["pubmed", "ensembl"] }),
      ),
    ).toEqual(["pubmed_search", "ensembl_lookup"]);
  });
});

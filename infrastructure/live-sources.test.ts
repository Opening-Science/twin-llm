import { describe, expect, test } from "bun:test";

import { LIVE_SOURCES, normaliseLiveSources, setLiveSourceEnabled } from "./live-sources";

describe("live sources", () => {
  test("the catalogue lists PubMed then Ensembl with their tools", () => {
    expect(LIVE_SOURCES.map((source) => [source.id, source.tools])).toEqual([
      ["pubmed", ["pubmed_search"]],
      ["ensembl", ["ensembl_lookup"]],
    ]);
  });

  test("nothing stored means every source is off", () => {
    expect([normaliseLiveSources(undefined), normaliseLiveSources([])]).toEqual([[], []]);
  });

  test("stored ids are cleaned and ordered", () => {
    expect(normaliseLiveSources(["ensembl", "uniprot", "pubmed", "ensembl", 3])).toEqual([
      "pubmed",
      "ensembl",
    ]);
  });

  test("a switch turns one source on or off", () => {
    expect(setLiveSourceEnabled([], "ensembl", true)).toEqual(["ensembl"]);
    expect(setLiveSourceEnabled(["pubmed", "ensembl"], "pubmed", false)).toEqual([
      "ensembl",
    ]);
  });
});

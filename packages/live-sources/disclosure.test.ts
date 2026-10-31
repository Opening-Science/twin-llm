import { describe, expect, test } from "bun:test";

import { isAllowedUrl, liveLookupDisclosure } from "./disclosure";

describe("isAllowedUrl", () => {
  test("only https on the two allowlisted origins", () => {
    expect(
      [
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?term=x",
        "https://rest.ensembl.org/lookup/symbol/homo_sapiens/APOE",
        "http://rest.ensembl.org/lookup",
        "https://rest.ensembl.org.example.org/lookup",
        "https://user:pw@rest.ensembl.org/lookup",
        "https://example.org/",
        "not a url",
      ].map(isAllowedUrl),
    ).toEqual([true, true, false, false, false, false, false]);
  });
});

describe("liveLookupDisclosure", () => {
  test("names recipient, step, purpose and kind of content, never a value", () => {
    expect(
      liveLookupDisclosure(
        { actor: "local", sessionId: "turn-1", mode: "personal" },
        {
          source: "pubmed",
          step: "esearch",
          url: "https://eutils.ncbi.nlm.nih.gov/x?term=a",
          carries: "search terms",
        },
      ),
    ).toEqual({
      actor: "local",
      sessionId: "turn-1",
      kind: "public-lookup",
      recipient: "NCBI PubMed",
      target: "esearch",
      purpose: "literature search",
      categories: ["search terms"],
      refs: [],
      payloadBytes: 40,
      threadId: null,
      synthetic: false,
    });
  });

  test("an id lookup is labelled as public record ids; synthetic follows the mode", () => {
    const row = liveLookupDisclosure(
      { actor: "a", sessionId: "s", mode: "synthetic" },
      {
        source: "ensembl",
        step: "variant",
        url: "https://rest.ensembl.org/v",
        carries: "public record ids",
      },
    );
    expect([row.recipient, row.purpose, row.categories, row.synthetic]).toEqual([
      "Ensembl",
      "gene and variant lookup",
      ["public record ids"],
      true,
    ]);
  });
});

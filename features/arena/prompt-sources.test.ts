import { describe, expect, test } from "bun:test";

import {
  IMPORT_HREF,
  matchSources,
  NO_SOURCE_FACTS,
  promptSources,
} from "./prompt-sources";

const NONE = { oura: false, whoop: false, googleHealth: false };

describe("promptSources (#366)", () => {
  test("with nothing linked or allowed only the import page is offered", () => {
    expect(promptSources(NO_SOURCE_FACTS, NONE)).toEqual([
      {
        key: "files",
        name: "Import a file",
        description: "Opens Customize · Data",
        href: IMPORT_HREF,
      },
    ]);
  });

  test("lists linked wearables, allowed data and switched-on lookups, in that order", () => {
    expect(
      promptSources(
        { imported: true, genome: true, live: ["ensembl", "pubmed"] },
        { oura: true, whoop: false, googleHealth: true },
      ).map((source) => source.key),
    ).toEqual([
      "oura",
      "google-health",
      "imported",
      "genome",
      "ensembl",
      "pubmed",
      "files",
    ]);
  });
});

describe("matchSources", () => {
  const all = promptSources(
    { imported: true, genome: false, live: ["pubmed"] },
    { oura: true, whoop: true, googleHealth: true },
  );

  test("an empty query lists every source; a word start narrows them", () => {
    expect(matchSources(all, "")).toEqual(all);
    expect(matchSources(all, "h").map((source) => source.key)).toEqual(["google-health"]);
    expect(matchSources(all, "im").map((source) => source.key)).toEqual([
      "imported",
      "files",
    ]);
    expect(matchSources(all, "zz")).toEqual([]);
  });
});

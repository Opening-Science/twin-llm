import { describe, expect, test } from "bun:test";

import {
  articleBaseName,
  chunkLiteratureArticle,
  citationJournal,
  citationYear,
  extractArticleBody,
  literatureDocumentId,
  type LiteratureRecord,
  parseLiteratureRecord,
  toLiteratureDocument,
  toLiteratureRecord,
} from "./article";
import { fixture } from "./fixture";
import { parsePmcMetadata } from "./pmc";

const META = parsePmcMetadata(fixture("metadata.json"));

const RECORD: LiteratureRecord = toLiteratureRecord(META, {
  specialty: "diet",
  licence: "cc-by",
  query: "q",
  fetchedAt: "2026-10-28T00:00:00.000Z",
});

describe("toLiteratureRecord", () => {
  test("keeps the licence and where the text is", () => {
    expect(RECORD).toEqual({
      pmcid: "PMC1000001",
      version: 2,
      specialty: "diet",
      title: "Synthetic fibre fixture",
      citation: "Synth Nutr J. 2024 Mar 2;1(1):1-2. doi: 10.0000/fixture.1",
      doi: "10.0000/fixture.1",
      pmid: 99000001,
      licence: "cc-by",
      licenceCode: "CC BY",
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1000001/",
      textFile: "PMC1000001.2.txt",
      query: "q",
      fetchedAt: "2026-10-28T00:00:00.000Z",
    });
    expect(articleBaseName("PMC9", 3)).toBe("PMC9.3");
  });
});

describe("parseLiteratureRecord", () => {
  test("round-trips a written record", () => {
    expect(parseLiteratureRecord(JSON.stringify(RECORD))).toEqual(RECORD);
  });

  test("refuses an unknown licence or specialty", () => {
    expect(() =>
      parseLiteratureRecord(JSON.stringify({ ...RECORD, licence: "tdm" })),
    ).toThrow("LITERATURE_RECORD_MALFORMED");
    expect(() =>
      parseLiteratureRecord(JSON.stringify({ ...RECORD, specialty: "cardio" })),
    ).toThrow("LITERATURE_RECORD_MALFORMED");
    expect(() => parseLiteratureRecord("[]")).toThrow("LITERATURE_RECORD_MALFORMED");
  });
});

describe("extractArticleBody", () => {
  test("drops front matter and references, marks headings", () => {
    expect(extractArticleBody(fixture("article.txt"))).toBe(
      [
        "# Section: Abstract",
        "",
        "A synthetic abstract written for tests.",
        "",
        "# Section: 1 INTRODUCTION",
        "",
        "Fibre intake was described in a made-up cohort.",
        "",
        "# Section: 2 METHODS",
        "",
        "# Section: 2.1 Data",
        "",
        "Values are invented for this fixture.",
        "",
        "# Section: Conclusions",
        "",
        "Nothing here is a finding.",
      ].join("\n"),
    );
  });

  test("keeps all text when there is no front matter", () => {
    expect(extractArticleBody("Plain text.\nSecond line.")).toBe(
      "Plain text.\nSecond line.",
    );
  });

  test("front matter without its closing separator keeps nothing", () => {
    expect(
      extractArticleBody("ARTICLE INFORMATION\n==========\nAuthor a@example.org\nBody."),
    ).toBe("");
  });

  test("a numbered sentence ending in a period is not a heading", () => {
    expect(extractArticleBody("1 This is a sentence.")).toBe("1 This is a sentence.");
  });
});

describe("citation helpers", () => {
  test("year and journal", () => {
    expect(citationYear(META.citation)).toBe(2024);
    expect(citationYear("no year")).toBe(0);
    expect(citationJournal(META.citation)).toBe("Synth Nutr J");
    expect(citationJournal("")).toBe("PMC");
  });
});

describe("toLiteratureDocument", () => {
  test("one document per specialty, tagged with its source", () => {
    expect(literatureDocumentId(RECORD)).toBe("lit-diet-PMC1000001.2");
    expect(toLiteratureDocument(RECORD)).toEqual({
      id: "lit-diet-PMC1000001.2",
      title: "Synthetic fibre fixture",
      year: 2024,
      society: "Synth Nutr J",
      doi: "10.0000/fixture.1",
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1000001/",
      licence: "cc-by",
      ingestMode: "full_text",
      source: "literature:diet",
    });
  });
});

describe("chunkLiteratureArticle", () => {
  test("one chunk per section with text, title in front, no references or emails", () => {
    const chunks = chunkLiteratureArticle(RECORD, fixture("article.txt"));
    expect(chunks.map((chunk) => chunk.sectionHeading)).toEqual([
      "Abstract",
      "1 INTRODUCTION",
      "2.1 Data",
      "Conclusions",
    ]);
    expect(chunks[0]?.text).toBe(
      "Synthetic fibre fixture · Abstract\n\nA synthetic abstract written for tests.",
    );
    const all = chunks.map((chunk) => chunk.text).join("\n");
    expect(all.includes("example.org")).toBe(false);
    expect(all.includes("must not be embedded")).toBe(false);
  });

  test("text without headings becomes one Article section", () => {
    expect(
      chunkLiteratureArticle(RECORD, "Only a paragraph.").map((chunk) => [
        chunk.sectionHeading,
        chunk.text,
      ]),
    ).toEqual([["Article", "Synthetic fibre fixture · Article\n\nOnly a paragraph."]]);
  });
});

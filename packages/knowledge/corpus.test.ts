import { describe, expect, test } from "bun:test";

import {
  chunkKnowledgeDocument,
  parseKnowledgeFile,
  readKnowledgeCorpus,
  type CorpusPorts,
} from "./corpus";
import { fileCorpusPorts } from "./fs-corpus";

const NOTE = [
  "# Title: Sample note",
  "",
  "Preamble line, CC BY 4.0.",
  "",
  "# Section: First part",
  "First body.",
  "",
  "# Section: Second part",
  "Second body.",
].join("\n");

const memoryPorts = (files: Record<string, string>): CorpusPorts => ({
  listFiles: async () => Object.keys(files),
  readFile: async (file) => {
    const text = files[file];
    if (text === undefined) throw new Error(`missing ${file}`);
    return text;
  },
});

describe("parseKnowledgeFile", () => {
  test("reads title, drops the preamble and sets the knowledge catalogue fields", () => {
    expect(parseKnowledgeFile("sample-note.md", NOTE)).toEqual({
      id: "opentwin-sample-note",
      file: "knowledge/opentwin/sample-note.md",
      title: "Sample note",
      year: 2026,
      society: "Open Science Foundation",
      doi: "",
      url: "knowledge/opentwin/sample-note.md",
      licence: "cc-by-4.0",
      ingestMode: "full_text",
      source: "opentwin-knowledge",
      body: "# Section: First part\nFirst body.\n\n# Section: Second part\nSecond body.",
    });
  });

  test("a file without a title or sections is refused", () => {
    expect(() => parseKnowledgeFile("a.md", "# Section: X\nBody")).toThrow(
      "KNOWLEDGE_TITLE_MISSING: a.md",
    );
    expect(() => parseKnowledgeFile("b.md", "# Title: B\nBody")).toThrow(
      "KNOWLEDGE_NO_SECTIONS: b.md",
    );
  });
});

describe("chunkKnowledgeDocument", () => {
  test("one chunk per section, file title in front", () => {
    const chunks = chunkKnowledgeDocument(parseKnowledgeFile("sample-note.md", NOTE));
    expect(chunks.map((chunk) => [chunk.sectionHeading, chunk.text])).toEqual([
      ["First part", "Sample note · First part\n\nFirst body."],
      ["Second part", "Sample note · Second part\n\nSecond body."],
    ]);
  });
});

describe("readKnowledgeCorpus", () => {
  test("sorted markdown files only, LICENSE and README skipped", async () => {
    const corpus = await readKnowledgeCorpus(
      memoryPorts({
        "z-last.md": NOTE,
        "LICENSE.md": "licence text",
        "README.md": "readme",
        "notes.txt": "not markdown",
        "a-first.md": NOTE,
      }),
    );
    expect(corpus.map((document) => document.id)).toEqual([
      "opentwin-a-first",
      "opentwin-z-last",
    ]);
  });

  test("the committed corpus parses, every section fits in one chunk", async () => {
    const corpus = await readKnowledgeCorpus(fileCorpusPorts());
    expect(corpus.map((document) => document.id)).toEqual([
      "opentwin-biomarker-catalogue",
      "opentwin-metric-glossary",
      "opentwin-provenance-and-audit",
      "opentwin-system-limits",
      "opentwin-units-and-codes",
    ]);
    for (const document of corpus) {
      const chunks = chunkKnowledgeDocument(document);
      const headings = chunks.map((chunk) => chunk.sectionHeading);
      expect(new Set(headings).size).toBe(headings.length);
      expect(headings).not.toContain("Untitled section");
    }
  });
});

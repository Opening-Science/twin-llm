import { beforeEach, describe, expect, test } from "bun:test";

import {
  drainLiteratureTurn,
  recordLiteratureTurn,
  resetLiteratureCollectorForTests,
  toLiteratureCitation,
} from "./collector";
import type { LiteratureHit } from "./hit";

/** A made-up article; the PMC id is not a real one. */
const hit: LiteratureHit = {
  kind: "literature",
  id: "lit-sleep-PMC0000005.1",
  specialty: "sleep",
  title: "Synthetic sleep article",
  journal: "J Synth Sleep",
  year: 2025,
  pmcid: "PMC0000005",
  url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC0000005/",
  doi: "",
  licence: "cc0",
  licenceLabel: "CC0",
  sectionHeading: "Methods",
  passage: "This text is never kept in a citation.",
  attribution: "a",
  quoting: "q",
  about: "b",
};

beforeEach(() => {
  resetLiteratureCollectorForTests();
});

describe("literature collector", () => {
  test("a citation keeps metadata, never the passage", () => {
    expect(toLiteratureCitation("knowledge.knowledge_search", hit)).toEqual({
      tool: "knowledge.knowledge_search",
      id: "lit-sleep-PMC0000005.1",
      title: "Synthetic sleep article",
      journal: "J Synth Sleep",
      year: 2025,
      pmcid: "PMC0000005",
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC0000005/",
      doi: "",
      licence: "cc0",
      licenceLabel: "CC0",
      sectionHeading: "Methods",
    });
  });

  test("records per turn and drains once", () => {
    const cite = toLiteratureCitation("t", hit);
    recordLiteratureTurn("turn-a", [cite]);
    recordLiteratureTurn("turn-a", [cite]);
    recordLiteratureTurn("turn-b", []);
    expect(drainLiteratureTurn("turn-a").sources).toEqual([cite, cite]);
    expect(drainLiteratureTurn("turn-a").sources).toEqual([]);
    expect(drainLiteratureTurn("turn-b").sources).toEqual([]);
  });
});

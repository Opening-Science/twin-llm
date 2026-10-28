import { describe, expect, test } from "bun:test";

import type { GuidelineJoinedRow } from "@/packages/guidelines/search";

import {
  articlePassage,
  isNoDerivatives,
  literatureAttribution,
  pmcidOfDocumentId,
  quotingRule,
  specialtyOfSource,
  toLiteratureHit,
} from "./hit";

/** A made-up article row; the PMC id is not a real one. */
const row: GuidelineJoinedRow = {
  id: "lit-anatomy-PMC0000004.2-1",
  sectionHeading: "Introduction",
  recommendationId: null,
  recClass: null,
  evidenceLevel: null,
  page: null,
  text: "Synthetic anatomy article · The liver lies in the upper right abdomen.",
  documentId: "lit-anatomy-PMC0000004.2",
  title: "Synthetic anatomy article",
  year: 0,
  society: "Synth Anat",
  doi: "",
  url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC0000004/",
  licence: "cc-by",
  ingestMode: "full_text",
  source: "literature:anatomy",
};

describe("literature hits", () => {
  test("specialtyOfSource reads literature sources only", () => {
    expect(specialtyOfSource("literature:sleep")).toBe("sleep");
    expect(specialtyOfSource("literature:cardiology")).toBeNull();
    expect(specialtyOfSource("opentwin-knowledge")).toBeNull();
    expect(specialtyOfSource("guideline")).toBeNull();
  });

  test("pmcidOfDocumentId", () => {
    expect(pmcidOfDocumentId("lit-diet-PMC1234567.3")).toBe("PMC1234567");
    expect(pmcidOfDocumentId("opentwin-metric-glossary")).toBeNull();
    expect(pmcidOfDocumentId("lit-diet-1234567.3")).toBeNull();
  });

  test("isNoDerivatives: the two ND licences", () => {
    expect(isNoDerivatives("cc-by-nd")).toBe(true);
    expect(isNoDerivatives("cc-by-nc-nd")).toBe(true);
    expect(isNoDerivatives("cc-by-nc-sa")).toBe(false);
    expect(isNoDerivatives("cc0")).toBe(false);
  });

  test("quotingRule adds the no-changes sentence for ND only", () => {
    expect(quotingRule("cc-by")).toBe(
      "Quote only word for word from passage, with the attribution line next to the quote.",
    );
    expect(quotingRule("cc-by-nd")).toBe(
      "Quote only word for word from passage, with the attribution line next to the quote. Its CC BY-ND licence allows no changes: quote it unchanged or not at all, never shortened, reworded or translated.",
    );
  });

  test("literatureAttribution leaves out a missing year", () => {
    expect(
      literatureAttribution({
        title: "A",
        journal: "J",
        year: 0,
        pmcid: "PMC1",
        licenceLabel: "CC0",
      }),
    ).toBe('"A". J. PMC1. CC0. via PubMed Central (NLM).');
  });

  test("articlePassage drops only the title the ingest put in front", () => {
    expect(articlePassage("T", "T · body text")).toBe("body text");
    expect(articlePassage("T", "Other · body text")).toBe("Other · body text");
  });

  test("toLiteratureHit", () => {
    expect(toLiteratureHit(row)).toEqual({
      kind: "literature",
      id: "lit-anatomy-PMC0000004.2",
      specialty: "anatomy",
      title: "Synthetic anatomy article",
      journal: "Synth Anat",
      year: 0,
      pmcid: "PMC0000004",
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC0000004/",
      doi: "",
      licence: "cc-by",
      licenceLabel: "CC BY",
      sectionHeading: "Introduction",
      passage: "The liver lies in the upper right abdomen.",
      attribution:
        '"Synthetic anatomy article". Synth Anat. PMC0000004. CC BY. via PubMed Central (NLM).',
      quoting:
        "Quote only word for word from passage, with the attribution line next to the quote.",
      about:
        "Published article as reference material, not a statement about this person.",
    });
  });

  test("a row whose licence, id or source cannot be read is not shown", () => {
    expect(toLiteratureHit({ ...row, licence: "publisher" })).toBeNull();
    expect(toLiteratureHit({ ...row, documentId: "lit-anatomy-x" })).toBeNull();
    expect(toLiteratureHit({ ...row, source: "guideline" })).toBeNull();
  });
});

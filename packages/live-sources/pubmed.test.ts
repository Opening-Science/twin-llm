import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  efetchUrl,
  esearchUrl,
  esummaryUrl,
  parseAbstracts,
  parseEsearchPmids,
  parseEsummary,
  pubmedCitation,
  snippet,
} from "./pubmed";

/** Recorded from NCBI on 2026-10-31 for "atrial fibrillation heart rate variability", 3 hits. */
const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

const identity = { tool: "twinllm", email: null };

describe("E-utilities addresses", () => {
  test("esearch carries the terms, the limit and the tool name", () => {
    expect(esearchUrl("atrial fibrillation", 3, identity)).toBe(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=atrial+fibrillation&retmax=3&retmode=json&sort=relevance&tool=twinllm",
    );
  });

  test("the operator's address is sent only when set", () => {
    expect(esummaryUrl(["1", "2"], { tool: "lab", email: "ops@example.org" })).toBe(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=1%2C2&retmode=json&tool=lab&email=ops%40example.org",
    );
    expect(efetchUrl(["9"], identity)).toBe(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=9&rettype=abstract&retmode=xml&tool=twinllm",
    );
  });
});

describe("parsing recorded responses", () => {
  test("esearch gives the PMIDs in NCBI's order", () => {
    expect(parseEsearchPmids(fixture("pubmed-esearch.json"))).toEqual([
      "31560809",
      "9727672",
      "40079735",
    ]);
  });

  test("a malformed esearch body throws a code", () => {
    expect(() => parseEsearchPmids('{"esearchresult":{}}')).toThrow(
      "PUBMED_ESEARCH_MALFORMED",
    );
  });

  test("esummary gives title, journal, year and DOI per PMID", () => {
    expect(
      parseEsummary(fixture("pubmed-esummary.json"), ["31560809", "9727672", "40079735"]),
    ).toEqual([
      {
        pmid: "31560809",
        title:
          "Heart rate variability in atrial fibrillation: The balance between sympathetic and parasympathetic nervous system.",
        journal: "European journal of clinical investigation",
        year: "2019",
        doi: "10.1111/eci.13174",
        url: "https://pubmed.ncbi.nlm.nih.gov/31560809/",
      },
      {
        pmid: "9727672",
        title: "Heart rate variability preceding onset of atrial fibrillation.",
        journal: "Journal of cardiovascular electrophysiology",
        year: "1998",
        doi: null,
        url: "https://pubmed.ncbi.nlm.nih.gov/9727672/",
      },
      {
        pmid: "40079735",
        title:
          "Heart rate variability in patients with atrial fibrillation of sinus rhythm or atrial fibrillation: chaos or merit?",
        journal: "Annals of medicine",
        year: "2025",
        doi: "10.1080/07853890.2025.2478474",
        url: "https://pubmed.ncbi.nlm.nih.gov/40079735/",
      },
    ]);
  });

  test("an id esummary does not describe is dropped", () => {
    expect(
      parseEsummary(
        '{"result":{"uids":["1"],"1":{"uid":"1","error":"cannot get document summary"}}}',
        ["1"],
      ),
    ).toEqual([]);
  });

  test("efetch gives a snippet of each abstract", () => {
    const abstracts = parseAbstracts(fixture("pubmed-efetch.xml"));
    expect([...abstracts.keys()]).toEqual(["31560809", "9727672", "40079735"]);
    expect(abstracts.get("9727672")).toBe(
      "The purpose of this article is to discuss the relationship between sympathovagal dysfunction and the occurrence of paroxysmal atrial fibrillation. Onset of atrial fibrillation is subject to circadian variation; shorter episodes occur more frequently during the day, whereas longer episodes occur …",
    );
  });

  test("labelled parts are joined and markup and entities are removed", () => {
    const xml =
      '<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID Version="1">7</PMID><Abstract><AbstractText Label="AIM">HRV &amp; <i>AF</i>.</AbstractText><AbstractText Label="RESULT">Lower&#x2009;HRV.</AbstractText></Abstract></MedlineCitation></PubmedArticle><PubmedArticle><MedlineCitation><PMID Version="1">8</PMID></MedlineCitation></PubmedArticle></PubmedArticleSet>';
    expect([...parseAbstracts(xml).entries()]).toEqual([["7", "HRV & AF. Lower HRV."]]);
  });
});

describe("snippet and citation", () => {
  test("cuts at a word boundary and marks the cut", () => {
    expect(snippet("one two three four", 9)).toBe("one two …");
    expect(snippet("short", 9)).toBe("short");
  });

  test("a citation names the PMID and its PubMed address", () => {
    expect(
      pubmedCitation({
        pmid: "9727672",
        title: "T",
        journal: "J",
        year: "1998",
        doi: null,
        abstractSnippet: null,
        url: "https://pubmed.ncbi.nlm.nih.gov/9727672/",
      }),
    ).toEqual({
      source: "PubMed",
      id: "PMID:9727672",
      title: "T",
      url: "https://pubmed.ncbi.nlm.nih.gov/9727672/",
    });
  });
});

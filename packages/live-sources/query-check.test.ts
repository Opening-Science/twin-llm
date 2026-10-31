import { describe, expect, test } from "bun:test";

import { checkLookupKey, checkSearchTerms, isGeneSymbol, isRsid } from "./query-check";

const plain = { genomeInTurn: false };

describe("checkSearchTerms", () => {
  test("words pass and are counted by kind", () => {
    expect(checkSearchTerms("atrial fibrillation heart rate variability", plain)).toEqual(
      {
        ok: true,
        terms: { words: 5, geneSymbols: 0, rsids: 0 },
      },
    );
  });

  test("gene symbols and rsIDs may carry digits", () => {
    expect(checkSearchTerms("CYP2C19 clopidogrel rs4244285 HLA-DRB1", plain)).toEqual({
      ok: true,
      terms: { words: 1, geneSymbols: 2, rsids: 1 },
    });
  });

  test("boolean words and PubMed field tags are words", () => {
    expect(checkSearchTerms('"sleep apnea"[mesh] AND HRV', plain)).toEqual({
      ok: true,
      terms: { words: 4, geneSymbols: 1, rsids: 0 },
    });
  });

  test("a plain number is refused", () => {
    expect(checkSearchTerms("resting heart rate 72", plain)).toEqual({
      ok: false,
      reason: "number",
    });
    expect(checkSearchTerms("type-2 diabetes", plain)).toEqual({
      ok: false,
      reason: "number",
    });
  });

  test("a token that only looks like a gene is refused when it holds a value", () => {
    expect(checkSearchTerms("HR72BP140 trend", plain)).toEqual({
      ok: false,
      reason: "number",
    });
    expect(checkSearchTerms("LINC00473 expression", plain)).toEqual({
      ok: false,
      reason: "number",
    });
  });

  test("a year is refused as a date", () => {
    expect(checkSearchTerms("sleep study 2024", plain)).toEqual({
      ok: false,
      reason: "date",
    });
  });

  test("dates, decimals and slashes are outside the character set", () => {
    expect(checkSearchTerms("hrv on 12/10", plain)).toEqual({
      ok: false,
      reason: "characters",
    });
    expect(checkSearchTerms("glucose 5.4", plain)).toEqual({
      ok: false,
      reason: "characters",
    });
  });

  test("addresses and links are identifiers", () => {
    expect(checkSearchTerms("contact someone@example.org", plain)).toEqual({
      ok: false,
      reason: "identifier",
    });
    expect(checkSearchTerms("see www example", plain)).toEqual({
      ok: true,
      terms: { words: 3, geneSymbols: 0, rsids: 0 },
    });
    expect(checkSearchTerms("see www.example.org", plain)).toEqual({
      ok: false,
      reason: "identifier",
    });
  });

  test("too short, too long or empty of terms is refused", () => {
    expect(checkSearchTerms("ab", plain)).toEqual({ ok: false, reason: "length" });
    expect(checkSearchTerms("a".repeat(201), plain)).toEqual({
      ok: false,
      reason: "length",
    });
    expect(checkSearchTerms("--- ,,,", plain)).toEqual({ ok: false, reason: "length" });
  });

  test("an rsID is refused while the genome is part of the turn", () => {
    expect(checkSearchTerms("rs429358 dementia", { genomeInTurn: true })).toEqual({
      ok: false,
      reason: "genome-rsid",
    });
    expect(checkSearchTerms("APOE dementia", { genomeInTurn: true })).toEqual({
      ok: true,
      terms: { words: 1, geneSymbols: 1, rsids: 0 },
    });
  });
});

describe("checkLookupKey", () => {
  test("a gene symbol or an rsID passes", () => {
    expect(checkLookupKey({ symbol: "BRCA1" }, plain)).toEqual({
      ok: true,
      terms: { words: 0, geneSymbols: 1, rsids: 0 },
    });
    expect(checkLookupKey({ rsid: "rs429358" }, plain)).toEqual({
      ok: true,
      terms: { words: 0, geneSymbols: 0, rsids: 1 },
    });
  });

  test("anything else is refused with its reason", () => {
    expect(checkLookupKey({ symbol: "140" }, plain)).toEqual({
      ok: false,
      reason: "number",
    });
    expect(checkLookupKey({ symbol: "my gene" }, plain)).toEqual({
      ok: false,
      reason: "characters",
    });
    expect(checkLookupKey({ rsid: "rs12x" }, plain)).toEqual({
      ok: false,
      reason: "characters",
    });
    expect(checkLookupKey({ rsid: "rs429358" }, { genomeInTurn: true })).toEqual({
      ok: false,
      reason: "genome-rsid",
    });
  });
});

describe("isGeneSymbol and isRsid", () => {
  test("HGNC-style symbols with at most three digits, none three in a row", () => {
    expect(["APOE", "CYP2C19", "HLA-B", "KCNH2", "SLC22A1"].map(isGeneSymbol)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(["apoe", "A1234", "AB12CD34", "1ABC"].map(isGeneSymbol)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  test("rs and up to twelve digits", () => {
    expect(["rs1", "rs429358", "RS429358", "rs1234567890123"].map(isRsid)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

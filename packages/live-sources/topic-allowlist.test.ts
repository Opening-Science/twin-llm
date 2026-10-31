import { describe, expect, test } from "bun:test";

import { checkSearchTerms, type QueryRefusalReason } from "./query-check";
import {
  removeAllowlistedTopics,
  TOPIC_ALLOWLIST,
  TOPIC_PHRASES,
} from "./topic-allowlist";

const plain = { genomeInTurn: false };

/** Every allowlisted phrase, named here so a change to the list shows in review. */
const EXPECTED_PHRASES = [
  "Diabetes Mellitus, Type 1",
  "Type 1 Diabetes",
  "Diabetes Mellitus, Type 2",
  "Type 2 Diabetes",
  "COVID-19",
  "COVID 19",
  "SARS-CoV-2",
  "Long QT Syndrome 1",
  "Long QT Syndrome Type 1",
  "Long QT Syndrome 2",
  "Long QT Syndrome 3",
  "H1N1",
  "H3N2",
  "H5N1",
  "HLA-B27",
  "HIV-1",
  "Vitamin B 12",
  "Vitamin B12",
  "Omega-3 Fatty Acid",
  "Omega-3 Fatty Acids",
  "Omega-6 Fatty Acid",
  "Omega-6 Fatty Acids",
  "Glucagon-Like Peptide 1",
  "GLP-1",
  "Sodium-Glucose Transporter 2 Inhibitors",
  "SGLT2 Inhibitors",
  "Cyclooxygenase 2 Inhibitors",
  "COX-2 Inhibitors",
  "Angiotensin II Type 1 Receptor Blockers",
  "Neurofibromatosis 1",
  "Neurofibromatosis Type 1",
  "Neurofibromatosis 2",
  "Neurofibromatosis Type 2",
  "22q11 Deletion Syndrome",
  "Multiple Endocrine Neoplasia Type 1",
  "Multiple Endocrine Neoplasia Type 2a",
  "Cytochrome P-450",
  "Cytochrome P450",
  "Interleukin-6",
  "IL-6",
  "Trisomy 21",
  "Hb A1c",
];

describe("TOPIC_ALLOWLIST", () => {
  test("holds exactly the reviewed phrases", () => {
    expect([...TOPIC_PHRASES].sort()).toEqual([...EXPECTED_PHRASES].sort());
  });

  test("every entry cites a MeSH descriptor or supplementary concept id", () => {
    for (const entry of TOPIC_ALLOWLIST) {
      expect(entry.meshId).toMatch(/^(?:D\d{6}|D\d{9}|C\d{6})$/);
      expect(entry.phrases.length).toBeGreaterThan(0);
    }
  });

  test("no phrase holds a year or a run of four digits", () => {
    for (const phrase of TOPIC_PHRASES) {
      expect(phrase).not.toMatch(/\d{4}/);
    }
  });
});

describe("allowlisted topics pass the search-term check", () => {
  for (const phrase of EXPECTED_PHRASES) {
    test(`"${phrase}" as written, in lower case and inside a query`, () => {
      expect(checkSearchTerms(phrase, plain).ok).toBe(true);
      expect(checkSearchTerms(phrase.toLowerCase(), plain).ok).toBe(true);
      expect(checkSearchTerms(`${phrase} sleep`, plain).ok).toBe(true);
      expect(checkSearchTerms(`"${phrase}"[mesh] AND heart rate`, plain).ok).toBe(true);
    });
  }

  test("the removed phrase's words still count as words", () => {
    expect(checkSearchTerms("type 2 diabetes sleep", plain)).toEqual({
      ok: true,
      terms: { words: 4, geneSymbols: 0, rsids: 0 },
    });
    expect(checkSearchTerms("covid-19 heart rate variability", plain)).toEqual({
      ok: true,
      terms: { words: 4, geneSymbols: 0, rsids: 0 },
    });
  });

  test("several topics in one query pass", () => {
    expect(
      checkSearchTerms("type 2 diabetes AND covid-19 AND long QT syndrome type 1", plain)
        .ok,
    ).toBe(true);
  });
});

describe("any other digit is still refused", () => {
  const refused = (query: string, reason: QueryRefusalReason) => {
    expect(checkSearchTerms(query, plain)).toEqual({ ok: false, reason });
  };

  test("a number next to an allowlisted phrase", () => {
    refused("type 2 diabetes 140", "number");
    refused("140 type 2 diabetes", "number");
    refused("covid-19 resting heart rate 58", "number");
    refused("long QT syndrome type 1 QTc 480", "number");
  });

  test("a digit glued to an allowlisted phrase", () => {
    refused("covid-190", "number");
    refused("type 2 diabetes2", "number");
    refused("2type 2 diabetes", "number");
    refused("long QT syndrome 12", "number");
    refused("trisomy 21-7", "number");
    refused("HIV-1-58", "number");
    refused("type 22 diabetes", "number");
  });

  test("a phrase that is not on the list", () => {
    refused("type 3 diabetes", "number");
    refused("long QT syndrome type 4", "number");
    refused("type-2 diabetes", "number");
    refused("stage 2 hypertension", "number");
  });

  test("a year is refused even beside an allowlisted phrase", () => {
    refused("covid-19 2021", "date");
    refused("type 2 diabetes 1999", "date");
    refused("coronavirus disease 2019", "date");
  });

  test("a date or decimal is outside the character set", () => {
    refused("covid-19 on 12/10", "characters");
    refused("type 2 diabetes HbA1c 6.5", "characters");
  });
});

describe("removeAllowlistedTopics", () => {
  test("replaces each whole phrase with a space and counts its words", () => {
    expect(removeAllowlistedTopics("Type 2  Diabetes and covid-19")).toEqual({
      rest: "  and  ",
      words: 4,
    });
  });

  test("leaves a phrase that a letter or digit touches", () => {
    expect(removeAllowlistedTopics("covid-190 xh1n1")).toEqual({
      rest: "covid-190 xh1n1",
      words: 0,
    });
  });

  test("prefers the longer phrase", () => {
    expect(removeAllowlistedTopics("omega-3 fatty acids")).toEqual({
      rest: " ",
      words: 3,
    });
  });
});

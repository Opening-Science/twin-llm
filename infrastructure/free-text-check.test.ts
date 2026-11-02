import { describe, expect, test } from "bun:test";

import {
  blocksSend,
  BLOCKING_KINDS,
  describeFreeTextCheck,
  FREE_TEXT_KIND,
  freeTextCheckOf,
  hasGenomeShapedText,
  isDistinctiveId,
  type KnownValue,
  knownValueMatches,
  lookupMatches,
  MAX_LOOKUPS,
  canonicalNumber,
  NO_STORED_VALUES,
  parseFreeTextMatches,
  type StoredValues,
  storedValueMatches,
  requestText,
  variantCandidates,
} from "./free-text-check";

describe("requestText", () => {
  test("a JSON body gives its string values, not its keys", () => {
    const body = JSON.stringify({
      model: "synthetic/model",
      messages: [{ role: "user", content: "What does rs4988235 do?" }],
      temperature: 0.2,
    });
    expect(requestText(body)).toBe("synthetic/model\nuser\nWhat does rs4988235 do?");
  });

  test("bytes are read as UTF-8 and plain text stays as it is", () => {
    expect(requestText(new TextEncoder().encode('["Démo body"]'))).toBe("Démo body");
    expect(requestText("not json rs1")).toBe("not json rs1");
    expect(requestText(undefined)).toBe("");
  });

  test("a body that cannot be read up front is null", () => {
    expect(requestText(new ReadableStream())).toBeNull();
    expect(requestText(new FormData())).toBeNull();
  });
});

describe("variantCandidates", () => {
  test("finds rsIDs once each, lowercased, as whole words", () => {
    expect(
      variantCandidates("RS4988235 and rs4988235, rs1801133; xrs12 rs12x").rsids,
    ).toEqual(["rs4988235", "rs1801133"]);
  });

  test("finds sites in both chromosome spellings and skips times", () => {
    expect(
      variantCandidates("chr7:117559590 and 1:230710048, then MT:16519 at 10:30").sites,
    ).toEqual([
      {
        site: "7:117559590|chr7:117559590",
        spellings: ["7:117559590", "chr7:117559590"],
      },
      {
        site: "1:230710048|chr1:230710048",
        spellings: ["1:230710048", "chr1:230710048"],
      },
      { site: "MT:16519|chrM:16519", spellings: ["MT:16519", "chrM:16519"] },
    ]);
  });

  test("caps the lookups per request", () => {
    const text = Array.from({ length: MAX_LOOKUPS + 20 }, (_, i) => `rs${i + 1}`).join(
      " ",
    );
    const candidates = variantCandidates(`${text} chr1:123456`);
    expect(candidates.rsids.length).toBe(MAX_LOOKUPS);
    expect(candidates.sites).toEqual([]);
  });
});

describe("lookupMatches", () => {
  const hashesOf = {
    rsid: (rsid: string) => [`h1.${rsid}`, `h2.${rsid}`],
    site: (spelling: string) => [`h1.${spelling}`],
  };

  test("counts the candidates whose hash a stored row holds, under any key", () => {
    const candidates = variantCandidates(
      "rs4988235 rs1801133 rs999 chr7:117559590 2:1234567",
    );
    expect(
      lookupMatches(candidates, hashesOf, {
        rsids: new Set(["h2.rs4988235", "h1.rs1801133", "h1.rs5"]),
        sites: new Set(["h1.7:117559590"]),
      }),
    ).toEqual([
      { kind: "rsID", count: 2 },
      { kind: "genome site", count: 1 },
    ]);
  });

  test("nothing stored, nothing found", () => {
    expect(
      lookupMatches(variantCandidates("rs4988235"), hashesOf, {
        rsids: new Set(),
        sites: new Set(),
      }),
    ).toEqual([
      { kind: "rsID", count: 0 },
      { kind: "genome site", count: 0 },
    ]);
  });
});

describe("knownValueMatches", () => {
  const known: readonly KnownValue[] = [
    { kind: FREE_TEXT_KIND.file, value: "synthea-v4-seed42.json" },
    { kind: FREE_TEXT_KIND.label, value: "Demo  Body" },
    { kind: FREE_TEXT_KIND.label, value: "Ann" },
    { kind: FREE_TEXT_KIND.account, value: "user_synthetic_1" },
  ];

  test("finds whole words, ignoring case and spacing, once per value", () => {
    expect(
      knownValueMatches(
        "Compare demo body with DEMO BODY. Source: synthea-v4-seed42.json",
        known,
      ),
    ).toEqual([
      { kind: "rsID", count: 0 },
      { kind: "genome site", count: 0 },
      { kind: "file name", count: 1 },
      { kind: "body scan label", count: 1 },
      { kind: "account id", count: 0 },
      { kind: "lab value", count: 0 },
      { kind: "coded value", count: 0 },
      { kind: "clinical record", count: 0 },
      { kind: "twin note line", count: 0 },
    ]);
  });

  test("a value inside a longer word is not found; one that is too short is not searched", () => {
    expect(
      knownValueMatches("user_synthetic_10 and demo bodyweight, Ann and Anne", known),
    ).toEqual([
      { kind: "rsID", count: 0 },
      { kind: "genome site", count: 0 },
      { kind: "file name", count: 0 },
      { kind: "body scan label", count: 0 },
      { kind: "account id", count: 0 },
      { kind: "lab value", count: 0 },
      { kind: "coded value", count: 0 },
      { kind: "clinical record", count: 0 },
      { kind: "twin note line", count: 0 },
    ]);
  });

  test("a later whole-word occurrence still counts after a partial one", () => {
    expect(
      knownValueMatches("user_synthetic_10, then user_synthetic_1.", known).find(
        (match) => match.kind === "account id",
      ),
    ).toEqual({ kind: "account id", count: 1 });
  });
});

describe("isDistinctiveId", () => {
  test("only ids with letters and digits and eight characters or more", () => {
    expect(isDistinctiveId("user_2synthetic")).toBe(true);
    expect(isDistinctiveId("local")).toBe(false);
    expect(isDistinctiveId("localuser")).toBe(false);
    expect(isDistinctiveId("u1")).toBe(false);
  });
});

describe("freeTextCheckOf and its words", () => {
  test("adds counts per kind, drops zeros and keeps a fixed order", () => {
    const check = freeTextCheckOf(
      [
        { kind: "file name", count: 1 },
        { kind: "rsID", count: 0 },
      ],
      [
        { kind: "rsID", count: 2 },
        { kind: "genome site", count: 1 },
        { kind: "file name", count: 1 },
      ],
    );
    expect(check).toEqual({
      matches: [
        { kind: "rsID", count: 2 },
        { kind: "genome site", count: 1 },
        { kind: "file name", count: 2 },
      ],
    });
    expect(describeFreeTextCheck(check)).toBe("2 rsIDs, 1 genome site, 2 file names");
    expect(describeFreeTextCheck(freeTextCheckOf())).toBe("no stored values found");
  });

  test("a stored result reads back, and anything else is null", () => {
    expect(parseFreeTextMatches([{ kind: "rsID", count: 3 }])).toEqual({
      matches: [{ kind: "rsID", count: 3 }],
    });
    expect(parseFreeTextMatches([])).toEqual({ matches: [] });
    expect(parseFreeTextMatches(null)).toBeNull();
    expect(parseFreeTextMatches([{ kind: "a value", count: 1 }])).toBeNull();
    expect(parseFreeTextMatches([{ kind: "rsID", count: 0 }])).toBeNull();
  });
});

describe("blocking (#356)", () => {
  test("only rsIDs and genome sites block", () => {
    expect(BLOCKING_KINDS).toEqual([FREE_TEXT_KIND.rsid, FREE_TEXT_KIND.site]);
    expect(blocksSend({ matches: [{ kind: "rsID", count: 1 }] })).toBe(true);
    expect(blocksSend({ matches: [{ kind: "genome site", count: 3 }] })).toBe(true);
    expect(
      blocksSend({
        matches: [
          { kind: "file name", count: 1 },
          { kind: "body scan label", count: 1 },
          { kind: "account id", count: 1 },
        ],
      }),
    ).toBe(false);
    expect(blocksSend({ matches: [] })).toBe(false);
  });

  test("genome-shaped text: rsIDs and sites on human chromosomes only", () => {
    expect(hasGenomeShapedText("Is rs4988235 in there?")).toBe(true);
    expect(hasGenomeShapedText("What is at chrX:153000000?")).toBe(true);
    expect(hasGenomeShapedText("and at 22:21000000")).toBe(true);
    expect(hasGenomeShapedText("Slept at 10:30, Ann Biomed Eng 37:1701-1709")).toBe(
      false,
    );
    expect(hasGenomeShapedText("chr23:12345 and 0:12345")).toBe(false);
    expect(hasGenomeShapedText("How did the Demo body sleep?")).toBe(false);
  });
});

describe("storedValueMatches", () => {
  /** A synthetic person: two readings, two clinical records, one twin note. */
  const stored: StoredValues = {
    readings: [
      { code: "2093-3", value: "195.0", unit: "mg/dL" },
      { code: "8867-4", value: "72", unit: "/min" },
      { code: null, value: "5.4", unit: "mmol/L" },
      { code: "1", value: "3", unit: "{score}" },
    ],
    records: [
      { code: "38341003", display: "Hypertension" },
      { code: null, display: "Lisinopril 10 MG Oral Tablet" },
    ],
    noteLines: ["Sleep", "Does evening exercise change my resting heart rate?"],
  };

  const counts = (text: string, typed = "") =>
    Object.fromEntries(
      storedValueMatches(text, stored, typed).map((match) => [match.kind, match.count]),
    );

  test("a stored number with its own unit, in any spelling of the number", () => {
    expect(counts("Total cholesterol 195 mg/dl, glucose 5.40mmol/L.")["lab value"]).toBe(
      2,
    );
  });

  test("a stored number with another unit, inside a longer number, or alone is not a lab value", () => {
    expect(
      counts("195 mmol/L, 1195 mg/dL, 195 mg/dLx, 5.4 and mg/dL apart, 3 {score}x")[
        "lab value"
      ],
    ).toBe(0);
  });

  test("a code with its own number nearby is a coded value; the code's own digits are not", () => {
    expect(
      counts('{"loinc":"2093-3","name":"Cholesterol","value":195}')["coded value"],
    ).toBe(1);
    expect(counts("LOINC 2093-3 is total cholesterol")["coded value"]).toBe(0);
    expect(counts("LOINC 12093-3 near 195")["coded value"]).toBe(0);
    // Too short to search for: "1" next to a 3.
    expect(counts("code 1, score 3")["coded value"]).toBe(0);
  });

  test("a clinical record by its code or its long name, not by a short name", () => {
    expect(counts("SNOMED 38341003 on file")["clinical record"]).toBe(1);
    expect(counts("Takes lisinopril 10 mg oral tablet daily")["clinical record"]).toBe(1);
    expect(counts("What is hypertension? See 383410031.")["clinical record"]).toBe(0);
  });

  test("a twin note line as a whole phrase; short lines are not searched", () => {
    expect(
      counts("Topics: does evening exercise change my  resting heart rate?; Sleep")[
        "twin note line"
      ],
    ).toBe(1);
    expect(counts("Sleep well")["twin note line"]).toBe(0);
  });

  test("a value the person typed is theirs: not counted, even where a reply repeats it", () => {
    const typed =
      "My cholesterol was 195 mg/dL. Does evening exercise change my resting heart rate?";
    const text = `${typed}\nEarlier answer: your cholesterol of 195 mg/dL is noted.`;
    expect(counts(text, typed)).toEqual({
      "lab value": 0,
      "coded value": 0,
      "clinical record": 0,
      "twin note line": 0,
    });
    // A stored value they did not type still counts.
    expect(counts(`${text} Glucose 5.4 mmol/L.`, typed)["lab value"]).toBe(1);
  });

  test("nothing stored, nothing found", () => {
    expect(
      storedValueMatches("195 mg/dL 2093-3", NO_STORED_VALUES).every(
        (match) => match.count === 0,
      ),
    ).toBe(true);
  });

  test("stored value kinds never block", () => {
    expect(
      blocksSend(
        freeTextCheckOf(storedValueMatches("195 mg/dL and 2093-3: 195", stored)),
      ),
    ).toBe(false);
  });
});

describe("canonicalNumber", () => {
  test("one spelling per number; anything else is null", () => {
    expect(canonicalNumber("195.0")).toBe("195");
    expect(canonicalNumber(" 5.40 ")).toBe("5.4");
    expect(canonicalNumber("-2.5")).toBe("2.5");
    expect(canonicalNumber("positive")).toBeNull();
    expect(canonicalNumber("1e3")).toBeNull();
  });
});

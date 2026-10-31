import { describe, expect, test } from "bun:test";

import {
  describeFreeTextCheck,
  FREE_TEXT_KIND,
  freeTextCheckOf,
  isDistinctiveId,
  type KnownValue,
  knownValueMatches,
  lookupMatches,
  MAX_LOOKUPS,
  parseFreeTextMatches,
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
    ]);
  });

  test("a later whole-word occurrence still counts after a partial one", () => {
    expect(
      knownValueMatches("user_synthetic_10, then user_synthetic_1.", known).at(-1),
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

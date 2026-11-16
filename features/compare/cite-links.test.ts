import { describe, expect, test } from "bun:test";

import type { ReferenceSource } from "@/infrastructure/claim-sources";

import { citeHref, citeTitle, claimSummaryLine } from "./cite-links";

const guideline: ReferenceSource = {
  label: "ean-als-2024",
  kind: "guideline",
  title: "EAN/ERN EURO-NMD guideline on ALS",
  url: "https://example.org/ean-als-2024",
  year: 2024,
};

describe("citation words (#612)", () => {
  test("names the kind, title and year", () => {
    expect(citeTitle(guideline)).toBe(
      "Guideline: EAN/ERN EURO-NMD guideline on ALS, 2024",
    );
    expect(citeTitle({ ...guideline, kind: "note", title: "HRV", year: 0 })).toBe(
      "OpenTwin note: HRV",
    );
  });

  test("links only a web address", () => {
    expect(citeHref(guideline)).toBe(guideline.url);
    expect(citeHref({ ...guideline, url: "" })).toBe(null);
    expect(citeHref({ ...guideline, url: "javascript:alert(1)" })).toBe(null);
  });
});

describe("claimSummaryLine (#612)", () => {
  const coverage = { claims: 5, cited: 2, unsupported: 1, invented: 1, uncited: 1 };

  test("says how many claims cite a returned source and what the rest do", () => {
    expect(claimSummaryLine(coverage)).toBe(
      "2 of 5 claims cite a source the searches returned; 1 marked unsupported; 1 cites a source no search returned; 1 cites nothing.",
    );
  });

  test("leaves out empty parts and agrees in number", () => {
    expect(
      claimSummaryLine({ claims: 1, cited: 1, unsupported: 0, invented: 0, uncited: 0 }),
    ).toBe("1 of 1 claim cites a source the searches returned.");
    expect(
      claimSummaryLine({ claims: 3, cited: 0, unsupported: 0, invented: 0, uncited: 3 }),
    ).toBe("0 of 3 claims cite a source the searches returned; 3 cite nothing.");
  });

  test("says nothing about an answer without claims", () => {
    expect(claimSummaryLine({ ...coverage, claims: 0, cited: 0 })).toBe(null);
  });
});

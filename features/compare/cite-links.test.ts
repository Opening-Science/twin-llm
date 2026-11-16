import { describe, expect, test } from "bun:test";

import type { ReferenceSource } from "@/infrastructure/claim-sources";

import { citeHref, citeTitle } from "./cite-links";

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

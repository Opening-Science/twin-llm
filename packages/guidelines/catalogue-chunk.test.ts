import { describe, expect, test } from "bun:test";

import { catalogueChunkText } from "./catalogue-chunk";
import { GUIDELINE_MANIFEST } from "./manifest";

describe("catalogueChunkText", () => {
  test("holds the catalogue fields and nothing else", () => {
    expect(
      catalogueChunkText({
        title: "ESC acute pulmonary embolism",
        year: 2019,
        society: "ESC",
        doi: "10.1093/eurheartj/ehz405",
        url: "https://doi.org/10.1093/eurheartj/ehz405",
      }),
    ).toBe(
      "ESC acute pulmonary embolism guideline. Published by ESC in 2019. DOI 10.1093/eurheartj/ehz405, https://doi.org/10.1093/eurheartj/ehz405. Catalogue entry only: the full text is not in the library.",
    );
  });

  test("every manifest entry gets a distinct catalogue text", () => {
    const texts = GUIDELINE_MANIFEST.map(catalogueChunkText);
    expect(new Set(texts).size).toBe(GUIDELINE_MANIFEST.length);
  });
});

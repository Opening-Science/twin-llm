import { describe, expect, test } from "bun:test";

import { assertIngestAllowed, GuidelineLicenceError } from "./licence";
import { GUIDELINE_MANIFEST, type GuidelineManifestEntry } from "./manifest";

const byId = (id: string): GuidelineManifestEntry => {
  const entry = GUIDELINE_MANIFEST.find((row) => row.id === id);
  if (!entry) throw new Error(`missing ${id}`);
  return entry;
};

const citeOnly = GUIDELINE_MANIFEST.filter((row) => row.ingestMode === "cite_only");

describe("guideline licence gate", () => {
  test("open CC rows may ingest full text", () => {
    expect(() => assertIngestAllowed(byId("ean-dementia-2020"))).not.toThrow();
    expect(() => assertIngestAllowed(byId("ean-ms-palliative-2020"))).not.toThrow();
    expect(() => assertIngestAllowed(byId("ean-als-2024"))).not.toThrow();
    expect(() => assertIngestAllowed(byId("ean-narcolepsy-2021"))).not.toThrow();
    expect(() => assertIngestAllowed(byId("gscm-influenza-children-2024"))).not.toThrow();
  });

  test("stroke and ESC rows are cite_only", () => {
    const ids = citeOnly.map((row) => row.id).sort();
    expect(ids).toEqual([
      "ean-stroke-rehab-2021",
      "esc-ccs-2019",
      "esc-dyslipidaemias-2019",
      "esc-pe-2019",
      "esc-svt-2019",
    ]);
  });

  test("full_text ingest throws for every cite_only id", () => {
    expect(citeOnly.length).toBe(5);
    for (const row of citeOnly) {
      expect(() => assertIngestAllowed({ ...row, ingestMode: "full_text" })).toThrow(
        GuidelineLicenceError,
      );
    }
  });

  test("cite_only path accepts publisher and ESC licences", () => {
    for (const row of citeOnly) {
      expect(() => assertIngestAllowed(row)).not.toThrow();
    }
  });
});

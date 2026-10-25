import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { listBiomarkers } from "@/packages/biomarkers/catalogue";
import { UNRENDERABLE_IDS } from "@/packages/biomarkers/unrenderable";

import { renderBiomarkerCatalogue } from "./biomarker-catalogue";
import { chunkKnowledgeDocument, parseKnowledgeFile } from "./corpus";

const committed = readFileSync(
  join(import.meta.dir, "../../knowledge/opentwin/biomarker-catalogue.md"),
  "utf8",
);

describe("biomarker catalogue knowledge file", () => {
  test("the committed file matches the pinned Anchor catalogue (run knowledge:biomarkers)", () => {
    expect(committed).toBe(renderBiomarkerCatalogue());
  });

  test("lists every marker once by id and LOINC, and marks the 14 D12 markers", () => {
    const markers = listBiomarkers();
    expect(markers).toHaveLength(67);
    const body = parseKnowledgeFile("biomarker-catalogue.md", committed).body;
    const sectionsBody = body.slice(body.indexOf("# Section: Cardiovascular"));
    for (const marker of markers) {
      expect(sectionsBody.split(`(${marker.id}):`).length - 1).toBe(1);
      expect(sectionsBody).toContain(`LOINC ${marker.loincCode},`);
    }
    expect(sectionsBody.split("No single body location.").length - 1).toBe(
      UNRENDERABLE_IDS.size,
    );
    expect(UNRENDERABLE_IDS.size).toBe(14);
  });

  test("every section fits in one chunk", () => {
    const chunks = chunkKnowledgeDocument(
      parseKnowledgeFile("biomarker-catalogue.md", committed),
    );
    const headings = chunks.map((chunk) => chunk.sectionHeading);
    expect(new Set(headings).size).toBe(headings.length);
    expect(headings).toHaveLength(15);
  });
});

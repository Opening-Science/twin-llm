/**
 * Writes knowledge/opentwin/biomarker-catalogue.md from the pinned Anchor
 * catalogue. Run after an open-twin pin bump: bun run knowledge:biomarkers
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { renderBiomarkerCatalogue } from "@/packages/knowledge/biomarker-catalogue";

const target = join(process.cwd(), "knowledge", "opentwin", "biomarker-catalogue.md");
writeFileSync(target, renderBiomarkerCatalogue());
console.warn(`wrote ${target}`);

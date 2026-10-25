/**
 * Copy for the Digital Twin page frame: section titles, one note per section
 * and the Sources lines. In one place so `lint:claims` checks it. Each line
 * says where data comes from, never what it means for a person.
 */
export const PAGE_TITLE = "Digital Twin";
export const BODY_TWIN = "Body twin";
export const BODY_TWIN_NOTE =
  "A 3D body with reference anatomy and biomarkers. Not a statement about a person.";
export const SOURCES_TITLE = "Sources";
export const SOURCES_NOTE = "Where this twin's data comes from.";
export const GENOME_TWIN = "Genome twin";
export const GENOME_NOTE =
  "Ark slot inventory and recent reads. The helix is decorative.";
export const GENOME_EMPTY = "No genome twin on this account.";

export const SOURCE_LABEL = {
  body: "Body",
  biomarkers: "Biomarkers",
  vitals: "Live vitals",
} as const;

export const SOURCE_TEXT = {
  demoBody: "Synthetic ANNY body, not a person.",
  scans: "BodyLoop scans of this subject.",
  demoBiomarkers: "Lab values of a synthetic cohort person, not of this body.",
  selfBiomarkers: "Your connected wearables.",
  demoVitals: "Vitals of a synthetic cohort person.",
  selfVitals: "Your connected wearables.",
} as const;

/** One plain sentence per missing source, so no part of the page is a blank box. */
export const EMPTY_TEXT = {
  scans: "No scans for this subject yet.",
  biomarkers: "No biomarker values for this subject.",
  biomarkersFailed: "Could not load biomarker values.",
  vitals: "No vitals for this subject.",
} as const;

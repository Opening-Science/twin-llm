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
/** Title of the collapsible list under Sources. */
export const SOURCES_PANEL = "By part";
export const GENOME_TWIN = "Genome twin";
export const GENOME_NOTE =
  "Your released Ark report, the slot inventory and recent reads. The helix is decorative.";
export const GENOME_EMPTY = "No genome twin on this account.";

/** The rsid-genotypes run and its released report. */
export const GENOME_REPORT_COPY = {
  title: "rsID genotypes",
  note: "Runs the rsid-genotypes app on your Ark. It reads up to eleven public CPIC / PharmGKB sites, each one you switch on, and releases only their recorded genotypes after you review the report on your phone. The report stays on this machine.",
  run: "Run on Ark",
  runAgain: "Run again",
  empty: "No report released yet.",
  approveTitle: "Waiting for your phone",
  steps: [
    {
      title: "Approve on your phone",
      body: "Approve the run in Ark Companion within 5 minutes, and switch on the sites you want read.",
    },
    {
      title: "Review and release the report on your phone",
      body: "Once the app ends, read the report and release it within 10 minutes. Nothing reaches this machine until you do.",
    },
  ],
  approveNote: "Keep this tab open and the Ark Hub tab closed.",
  noCall: "no call",
  notGranted: "not granted",
  notGrantedNote:
    "Not granted: the site was switched off at approval or is not on the Ark. The app cannot tell which.",
  tableCaption: "Recorded genotypes at the eleven panel sites",
} as const;

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

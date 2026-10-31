/**
 * Public disease and topic names that contain digits (#349). The search-term
 * check refuses any digit outside a gene symbol or an rsID, which would also
 * turn away "type 2 diabetes" or "COVID-19". Each phrase here is a MeSH heading
 * name or one of its entry terms, copied from the NLM record named by `meshId`
 * (https://meshb.nlm.nih.gov/record/ui?ui=<meshId>). The two `C` ids are MeSH
 * supplementary concept records, used where MeSH has no heading for a long QT
 * type. No phrase contains a year.
 *
 * A phrase is matched whole and case-insensitively, and is removed before the
 * digit rule runs. Any other digit in the query is still refused. Adding a
 * phrase needs a review: it must be a public name from MeSH, never a value.
 *
 * Pure: no I/O.
 */

export type TopicEntry = Readonly<{
  meshId: string;
  heading: string;
  phrases: readonly string[];
}>;

export const TOPIC_ALLOWLIST: readonly TopicEntry[] = [
  {
    meshId: "D003922",
    heading: "Diabetes Mellitus, Type 1",
    phrases: ["Diabetes Mellitus, Type 1", "Type 1 Diabetes"],
  },
  {
    meshId: "D003924",
    heading: "Diabetes Mellitus, Type 2",
    phrases: ["Diabetes Mellitus, Type 2", "Type 2 Diabetes"],
  },
  { meshId: "D000086382", heading: "COVID-19", phrases: ["COVID-19", "COVID 19"] },
  { meshId: "D000086402", heading: "SARS-CoV-2", phrases: ["SARS-CoV-2"] },
  {
    meshId: "D029597",
    heading: "Romano-Ward Syndrome",
    phrases: ["Long QT Syndrome 1", "Long QT Syndrome Type 1"],
  },
  { meshId: "C563614", heading: "Long Qt Syndrome 2", phrases: ["Long QT Syndrome 2"] },
  { meshId: "C565840", heading: "Long Qt Syndrome 3", phrases: ["Long QT Syndrome 3"] },
  { meshId: "D053118", heading: "Influenza A Virus, H1N1 Subtype", phrases: ["H1N1"] },
  { meshId: "D053122", heading: "Influenza A Virus, H3N2 Subtype", phrases: ["H3N2"] },
  { meshId: "D053124", heading: "Influenza A Virus, H5N1 Subtype", phrases: ["H5N1"] },
  { meshId: "D015796", heading: "HLA-B27 Antigen", phrases: ["HLA-B27"] },
  { meshId: "D015497", heading: "HIV-1", phrases: ["HIV-1"] },
  {
    meshId: "D014805",
    heading: "Vitamin B 12",
    phrases: ["Vitamin B 12", "Vitamin B12"],
  },
  {
    meshId: "D015525",
    heading: "Fatty Acids, Omega-3",
    phrases: ["Omega-3 Fatty Acid", "Omega-3 Fatty Acids"],
  },
  {
    meshId: "D043371",
    heading: "Fatty Acids, Omega-6",
    phrases: ["Omega-6 Fatty Acid", "Omega-6 Fatty Acids"],
  },
  {
    meshId: "D052216",
    heading: "Glucagon-Like Peptide 1",
    phrases: ["Glucagon-Like Peptide 1", "GLP-1"],
  },
  {
    meshId: "D000077203",
    heading: "Sodium-Glucose Transporter 2 Inhibitors",
    phrases: ["Sodium-Glucose Transporter 2 Inhibitors", "SGLT2 Inhibitors"],
  },
  {
    meshId: "D052246",
    heading: "Cyclooxygenase 2 Inhibitors",
    phrases: ["Cyclooxygenase 2 Inhibitors", "COX-2 Inhibitors"],
  },
  {
    meshId: "D047228",
    heading: "Angiotensin II Type 1 Receptor Blockers",
    phrases: ["Angiotensin II Type 1 Receptor Blockers"],
  },
  {
    meshId: "D009456",
    heading: "Neurofibromatosis 1",
    phrases: ["Neurofibromatosis 1", "Neurofibromatosis Type 1"],
  },
  {
    meshId: "D016518",
    heading: "Neurofibromatosis 2",
    phrases: ["Neurofibromatosis 2", "Neurofibromatosis Type 2"],
  },
  {
    meshId: "D058165",
    heading: "22q11 Deletion Syndrome",
    phrases: ["22q11 Deletion Syndrome"],
  },
  {
    meshId: "D018761",
    heading: "Multiple Endocrine Neoplasia Type 1",
    phrases: ["Multiple Endocrine Neoplasia Type 1"],
  },
  {
    meshId: "D018813",
    heading: "Multiple Endocrine Neoplasia Type 2a",
    phrases: ["Multiple Endocrine Neoplasia Type 2a"],
  },
  {
    meshId: "D003577",
    heading: "Cytochrome P-450 Enzyme System",
    phrases: ["Cytochrome P-450", "Cytochrome P450"],
  },
  { meshId: "D015850", heading: "Interleukin-6", phrases: ["Interleukin-6", "IL-6"] },
  { meshId: "D004314", heading: "Down Syndrome", phrases: ["Trisomy 21"] },
  { meshId: "D006442", heading: "Glycated Hemoglobin", phrases: ["Hb A1c"] },
];

/** Every allowlisted phrase, longest first so a longer name wins over a shorter one. */
export const TOPIC_PHRASES: readonly string[] = TOPIC_ALLOWLIST.flatMap(
  (entry) => entry.phrases,
).toSorted((a, b) => b.length - a.length);

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One pattern for all phrases. A phrase only counts when no letter or digit
 * touches either end, so "COVID-190" or "type 2 diabetes2" is not a match and
 * its digits stay in the query. Spaces inside a phrase match one or more spaces.
 */
const TOPIC_PATTERN = new RegExp(
  `(?<![A-Za-z0-9])(?:${TOPIC_PHRASES.map((phrase) =>
    escapeRegExp(phrase).replace(/ /g, " +"),
  ).join("|")})(?![A-Za-z0-9])`,
  "gi",
);

export type TopicRemoval = Readonly<{
  /** The query with every allowlisted phrase replaced by a space. */
  rest: string;
  /** How many words the removed phrases held, for the audit's word count. */
  words: number;
}>;

const wordsIn = (phrase: string): number =>
  phrase.split(/[^A-Za-z0-9-]+/).filter((token) => token.replace(/-/g, "") !== "").length;

/** Removes allowlisted topic names from a query so the digit rule sees only the rest. */
export const removeAllowlistedTopics = (query: string): TopicRemoval => {
  const matches = query.match(TOPIC_PATTERN) ?? [];
  return {
    rest: query.replace(TOPIC_PATTERN, " "),
    words: matches.reduce((sum, match) => sum + wordsIn(match), 0),
  };
};

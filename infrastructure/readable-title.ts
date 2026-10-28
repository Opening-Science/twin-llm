/**
 * A thread title a person can scan. Titles are the first prompt, and the
 * prompts the chips and the eval write lead with a 36-character subject_ref
 * and carry LOINC codes for the model's sake: "For subject_ref 29bbf012-…:
 * what is the latest systolic…". The sidebar then shows the same opaque start
 * for every thread.
 *
 * Pure. The subject stays, shortened to its first six characters at the end,
 * so two people's threads still read apart. Used when a thread is named and
 * when old threads are listed, so stored titles are left as they were.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const LEADING_SUBJECT = new RegExp(
  `^\\s*for\\s+(?:synthetic\\s+subject|subject_ref|subject)\\s+(${UUID})\\s*[:,]?\\s*`,
  "i",
);
const INNER_SUBJECT = new RegExp(
  `\\s*(?:for|of)\\s+(?:synthetic\\s+subject|subject_ref|subject)\\s+(${UUID})`,
  "gi",
);
const BARE_SUBJECT = new RegExp(`(?:subject_ref\\s+)?(${UUID})`, "gi");
const LOINC_ASIDE = /\s*\(LOINC [0-9-]+(?:,\s*[0-9-]+)*\)/gi;
const USING_LOINC = /\busing LOINC [0-9-]+(?:,\s*[0-9-]+)*,\s*/gi;

const upperFirst = (text: string): string =>
  text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;

export const readableTitle = (raw: string): string => {
  const subjects: string[] = [];
  const keep = (_: string, ref: string) => {
    subjects.push(ref.toLowerCase());
    return "";
  };
  const text = raw
    .replace(LEADING_SUBJECT, keep)
    .replace(INNER_SUBJECT, keep)
    .replace(BARE_SUBJECT, keep)
    .replace(USING_LOINC, "")
    .replace(LOINC_ASIDE, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (subjects.length === 0) return raw.trim();
  const tag = [...new Set(subjects)].map((ref) => ref.slice(0, 6)).join(", ");
  return text === "" ? `Subject ${tag}` : `${upperFirst(text)} · subject ${tag}`;
};

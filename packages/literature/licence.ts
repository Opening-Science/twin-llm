/**
 * Article licences as PMC records them (`license_code` in the PMC Article
 * Datasets metadata) and what TwinLLM may do with each. Conservative on
 * purpose: storing and quoting with attribution is allowed for every Creative
 * Commons licence (research use, non-commercial included), but only CC0 and
 * CC BY count as usable for model training. NC and ND are never training data;
 * SA needs a review first. Anything else, including PMC's `TDM` (author
 * manuscripts) and a missing code, is skipped.
 */

export type LiteratureLicence =
  "cc0" | "cc-by" | "cc-by-sa" | "cc-by-nd" | "cc-by-nc" | "cc-by-nc-sa" | "cc-by-nc-nd";

export type TrainingUse = "allowed" | "review" | "no";

export type LicenceTerms = Readonly<{
  label: string;
  commercial: boolean;
  training: TrainingUse;
}>;

export const LICENCE_TERMS: Readonly<Record<LiteratureLicence, LicenceTerms>> = {
  cc0: { label: "CC0", commercial: true, training: "allowed" },
  "cc-by": { label: "CC BY", commercial: true, training: "allowed" },
  "cc-by-sa": { label: "CC BY-SA", commercial: true, training: "review" },
  "cc-by-nd": { label: "CC BY-ND", commercial: true, training: "no" },
  "cc-by-nc": { label: "CC BY-NC", commercial: false, training: "no" },
  "cc-by-nc-sa": { label: "CC BY-NC-SA", commercial: false, training: "no" },
  "cc-by-nc-nd": { label: "CC BY-NC-ND", commercial: false, training: "no" },
};

export const LITERATURE_LICENCES = Object.keys(
  LICENCE_TERMS,
) as readonly LiteratureLicence[];

export const isLiteratureLicence = (value: string): value is LiteratureLicence =>
  (LITERATURE_LICENCES as readonly string[]).includes(value);

/**
 * "CC BY-NC-ND", "cc by nc nd 4.0" and "CC-BY-NC-ND" all become
 * `cc-by-nc-nd`. A version number is dropped: PMC's code carries none.
 * Returns null for anything that is not a known Creative Commons licence.
 */
export const normaliseLicenceCode = (
  code: string | null | undefined,
): LiteratureLicence | null => {
  if (code == null) return null;
  const words = code
    .toLowerCase()
    .replace(/\b\d+(\.\d+)?\b/g, " ")
    .split(/[\s_-]+/)
    .filter((word) => word.length > 0);
  const id = words.join("-");
  if (id === "cc0" || id === "cc-zero") return "cc0";
  return isLiteratureLicence(id) ? id : null;
};

export type LicenceDecision =
  | Readonly<{ ok: true; licence: LiteratureLicence }>
  | Readonly<{ ok: false; reason: "unknown-licence" | "not-allowed"; code: string }>;

/** Whether an article with this PMC licence code may be stored locally. */
export const decideLicence = (
  code: string | null | undefined,
  allowed: readonly LiteratureLicence[] = LITERATURE_LICENCES,
): LicenceDecision => {
  const licence = normaliseLicenceCode(code);
  if (licence === null) {
    return { ok: false, reason: "unknown-licence", code: code ?? "none" };
  }
  if (!allowed.includes(licence)) {
    return { ok: false, reason: "not-allowed", code: code ?? licence };
  }
  return { ok: true, licence };
};

/** The licences that may be used to train a model, without further review. */
export const trainingLicences = (): LiteratureLicence[] =>
  LITERATURE_LICENCES.filter((licence) => LICENCE_TERMS[licence].training === "allowed");

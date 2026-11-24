/**
 * Refusals of a measure named by name or code (#900): an unknown name, a
 * name the readings do not settle, and a code that fails LOINC's check
 * digit. Each stops the call before any observation is read, so a code the
 * model made up never reaches the database.
 */

export type MeasureSuggestion = Readonly<{ measure: string; loinc: readonly string[] }>;

export type UnknownMeasure = Readonly<{
  code: "UNKNOWN_MEASURE";
  error: string;
  measure: string;
  /** Known names sharing a word with it; to choose from, never a match. */
  suggestions: readonly MeasureSuggestion[];
}>;

/** A name not in the name table (`measure-names.ts`): nothing is guessed. */
export const unknownMeasure = (
  measure: string,
  suggestions: readonly MeasureSuggestion[],
): UnknownMeasure => ({
  code: "UNKNOWN_MEASURE",
  error:
    suggestions.length === 0
      ? "no measure of this name is known; name it another way, or give its LOINC code"
      : "no measure of this name is known; call again with a suggestion only if it is the measure meant, otherwise say this measure is not recorded",
  measure,
  suggestions: [...suggestions],
});

export type AmbiguousMeasureCandidate = Readonly<{
  loinc: string;
  name: string;
  /** Whether this subject (or dataset) has a reading of the code. */
  has_readings: boolean;
}>;

export type AmbiguousMeasure = Readonly<{
  code: "AMBIGUOUS_MEASURE";
  error: string;
  measure: string;
  candidates: readonly AmbiguousMeasureCandidate[];
}>;

/** A name that fits several codes, and the readings leave none or several of them. */
export const ambiguousMeasure = (
  measure: string,
  candidates: readonly AmbiguousMeasureCandidate[],
): AmbiguousMeasure => ({
  code: "AMBIGUOUS_MEASURE",
  error: candidates.some((candidate) => candidate.has_readings)
    ? "this name fits more than one code with readings; call again with the loinc of the one meant, or ask which is meant"
    : "this name fits more than one code and none has a reading here; say there is no reading under this name",
  measure,
  candidates: [...candidates],
});

export type InvalidLoinc = Readonly<{
  code: "INVALID_LOINC";
  error: string;
  loinc: readonly string[];
}>;

/** A code that fails LOINC's check digit is not a LOINC code and is never read. */
export const invalidLoinc = (codes: readonly string[]): InvalidLoinc => ({
  code: "INVALID_LOINC",
  error:
    "not a LOINC code (its check digit is wrong), so nothing was read; name the measure in measure instead",
  loinc: [...codes],
});

export type MeasureRefusal = UnknownMeasure | AmbiguousMeasure | InvalidLoinc;

export const MEASURE_REFUSAL_CODES = [
  "UNKNOWN_MEASURE",
  "AMBIGUOUS_MEASURE",
  "INVALID_LOINC",
] as const;

import type { ImportKind } from "@/packages/personal-data/types";

/**
 * The formats Customize · Data offers, in the order shown. The first three
 * import now; the rest are listed with the issue that will add them, so
 * nobody wonders whether their file was forgotten.
 */

export type ImportFormat = Readonly<{
  kind: ImportKind;
  label: string;
  detail: string;
  accept: string;
}>;

export const IMPORT_FORMATS: readonly ImportFormat[] = [
  {
    kind: "fhir",
    label: "FHIR records",
    detail:
      "A FHIR R4 Bundle, one resource, or NDJSON from a patient portal or bulk export. Numbers with units, conditions and medication requests are kept.",
    accept: ".json,.ndjson,application/json,application/fhir+json",
  },
  {
    kind: "lab-csv",
    label: "Lab results (CSV)",
    detail:
      "Columns date, test, value and unit, and optionally loinc and note. Units are kept as written.",
    accept: ".csv,.tsv,.txt,text/csv,text/tab-separated-values",
  },
  {
    kind: "table",
    label: "Research table",
    detail:
      "Any CSV or TSV with a header row: up to 200 columns and 200,000 rows. Column types are inferred as number, date or text.",
    accept: ".csv,.tsv,.txt,text/csv,text/tab-separated-values",
  },
];

export type NextFormat = Readonly<{ label: string; issue: number }>;

export const NEXT_FORMATS: readonly NextFormat[] = [
  { label: "Apple Health export", issue: 178 },
  { label: "Wearable export files (Oura, Whoop, Google)", issue: 179 },
  { label: "Genome VCF, local models only", issue: 180 },
];

export const ISSUES_URL = "https://github.com/Opening-Science/twin-llm/issues";

export const kindLabel = (kind: ImportKind): string =>
  IMPORT_FORMATS.find((format) => format.kind === kind)?.label ?? kind;

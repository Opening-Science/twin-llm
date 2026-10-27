/**
 * Shapes for a person's own imported data (Customize · Data, docs/personal-data.md).
 *
 * Parsing is pure and stores nothing: a parse gives drafts, the review shows
 * them, and only Save writes them to the personal tables. These tables are
 * never the synthetic warehouse (`subjects`, `observations`).
 */

/** Formats with a full import flow in this version. */
export const IMPORT_KINDS = ["fhir", "lab-csv", "table"] as const;

export type ImportKind = (typeof IMPORT_KINDS)[number];

export const isImportKind = (value: unknown): value is ImportKind =>
  typeof value === "string" && (IMPORT_KINDS as readonly string[]).includes(value);

/** How much of a date the source gave: `2024`, `2024-03`, `2024-03-01` or a time. */
export type EffectivePrecision = "year" | "month" | "day" | "instant";

/** One number with its unit as the file gave it. */
export type ObservationDraft = Readonly<{
  /** `http://loinc.org` or the coding system the file named; null when uncoded. */
  codeSystem: string | null;
  code: string | null;
  display: string;
  value: number;
  /** As written in the file, never converted. */
  unit: string;
  /** True when `unit` is a valid UCUM code. */
  unitUcum: boolean;
  effectiveAt: Date;
  effectivePrecision: EffectivePrecision;
  /** Where it came from in the file: a FHIR id or `row 12`. */
  sourceRef: string;
  note: string | null;
}>;

/** A FHIR Condition or MedicationRequest, as recorded. */
export type ClinicalDraft = Readonly<{
  resourceType: "Condition" | "MedicationRequest";
  codeSystem: string | null;
  code: string | null;
  display: string;
  startAt: Date | null;
  endAt: Date | null;
  status: string | null;
  sourceRef: string;
}>;

export type ColumnType = "number" | "date" | "text";

export type TableColumn = Readonly<{
  name: string;
  type: ColumnType;
  /** Cells left empty (or NA) in this column. */
  missing: number;
}>;

/** A number, a date as written (`2024-03-01`), text, or null for a missing cell. */
export type TableCell = number | string | null;

export type TableDraft = Readonly<{
  columns: readonly TableColumn[];
  rows: readonly (readonly TableCell[])[];
}>;

/** A row or resource that is reported, not stored. */
export type Unmapped = Readonly<{
  where: string;
  code: string;
  reason: string;
}>;

export type ImportRefusal = Readonly<{
  code: string;
  /** One plain sentence for the person; never an exception text. */
  message: string;
}>;

type ParsedBase = Readonly<{
  unmapped: readonly Unmapped[];
  /** Plain sentences about what was left out on purpose. */
  notes: readonly string[];
}>;

export type ParsedImport =
  | (ParsedBase &
      Readonly<{
        ok: true;
        kind: "fhir";
        observations: readonly ObservationDraft[];
        clinical: readonly ClinicalDraft[];
      }>)
  | (ParsedBase &
      Readonly<{
        ok: true;
        kind: "lab-csv";
        observations: readonly ObservationDraft[];
      }>)
  | (ParsedBase & Readonly<{ ok: true; kind: "table"; table: TableDraft }>)
  | Readonly<{ ok: false; refusal: ImportRefusal }>;

export type ParsedOk = Extract<ParsedImport, { ok: true }>;

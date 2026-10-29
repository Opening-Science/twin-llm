import type { AppendInput } from "@/packages/audit/append";
import type { EffectivePrecision, ImportKind } from "@/packages/personal-data/types";

/**
 * What the imported-data tools need from outside: fixed reads of one
 * person's personal_* tables and the audit append. The reads are already
 * bound to that person (`infrastructure/personal-data-store.ts`), so a tool
 * can never name another user. They never touch the synthetic warehouse.
 * Tests pass in-memory functions.
 */

export type ImportedDatasetRecord = Readonly<{
  id: string;
  kind: ImportKind;
  name: string;
  rowCount: number;
  firstAt: string | null;
  lastAt: string | null;
}>;

/** The code system every coded read is held to; another system's codes are never read as LOINC. */
export const LOINC_SYSTEM = "http://loinc.org";

/** Observation rows grouped by dataset, code system, code, name and unit, as stored. */
export type ImportedSeriesGroup = Readonly<{
  datasetId: string;
  codeSystem: string | null;
  code: string | null;
  display: string;
  unit: string;
  n: number;
  firstAt: Date;
  lastAt: Date;
}>;

export type ImportedObservationRecord = Readonly<{
  id: string;
  datasetId: string;
  code: string | null;
  display: string;
  value: number;
  /** As the file wrote it, never converted. */
  unit: string;
  effectiveAt: Date;
  effectivePrecision: EffectivePrecision;
}>;

export type ImportedLatestQuery = Readonly<{
  codes: readonly string[];
  /** One dataset, or null for all of the person's datasets. */
  datasetId: string | null;
}>;

/**
 * One series: a LOINC code, or a name stored with no code. Exactly one of the
 * two is set, so a coded series and one stored by name are never read together.
 */
export type ImportedSeriesQuery = Readonly<{
  datasetId: string;
  code: string | null;
  name: string | null;
  start: Date;
  end: Date;
  take: number;
}>;

export type ImportedDataPorts = Readonly<{
  /** The person's datasets, newest first. */
  listDatasets: () => Promise<readonly ImportedDatasetRecord[]>;
  /** At most `take` groups, ordered by dataset, code, name and unit. */
  listSeries: (take: number) => Promise<readonly ImportedSeriesGroup[]>;
  /** For each LOINC code, its newest row (a tie at one instant to the lower id). */
  findLatest: (
    query: ImportedLatestQuery,
  ) => Promise<readonly ImportedObservationRecord[]>;
  /** One series in one dataset in a window, by time ascending, at most `take`. */
  findSeries: (
    query: ImportedSeriesQuery,
  ) => Promise<readonly ImportedObservationRecord[]>;
  appendAudit: (input: AppendInput) => Promise<unknown>;
}>;

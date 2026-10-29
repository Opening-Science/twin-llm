import type { z } from "zod";

import type { ImportedDataPermitDecision } from "@/infrastructure/data-mode-policy";

import {
  IMPORTED_DATASETS_TOOL,
  IMPORTED_LATEST_TOOL,
  IMPORTED_TREND_TOOL,
} from "./imported-names";
import type { ImportedDataPorts } from "./imported-ports";
import {
  datasetNotFound,
  importedMixedUnits,
  importedNoRows,
  importedNotPermitted,
  type ImportedRefusal,
  partialDates,
  seriesNotCombined,
} from "./imported-refusals";
import type {
  importedDatasetsInput,
  importedLatestInput,
  importedTrendInput,
} from "./imported-schemas";
import {
  type ImportedDatasetEntry,
  newestPerCode,
  partialDateCount,
  seriesListing,
  storedUnits,
} from "./imported-series";
import {
  ANALYTICS_ROW_CAP,
  isToolRefusal,
  ROW_CAP_EXCEEDED,
  type RowCapExceeded,
} from "./refusals";
import { windowEndDate, windowStartDate } from "./schemas";
import type { SessionScope } from "./scope";
import { olsSlopePerDay } from "./stats";

/**
 * The chat tools over a person's own imported data (#181,
 * docs/query-layer.md "Imported data tools").
 *
 * - Every call asks `permit` first: personal mode and Ollama on loopback
 *   (`permitImportedDataRequest`). Anything else is refused before a read.
 * - Reads go through `ImportedDataPorts`, bound to one person's personal_*
 *   rows. The synthetic warehouse is never read here, and these rows never
 *   reach a warehouse tool.
 * - Every call, refusal and throw writes one audit row with ids and counts
 *   only: never a value, unit, code or name, nor a hash of one (a short value
 *   is easy to recover from its hash). That is why these tools do not use
 *   `audited()`, which hashes the full arguments and result.
 * - A series is one LOINC code or one name stored without a code, never both.
 */

export type ImportedToolDeps = Readonly<{
  scope: SessionScope;
  /** Asked before every call; the chat route passes the live policy. */
  permit: () => ImportedDataPermitDecision;
  ports: ImportedDataPorts;
}>;

/** Series one listing returns; more is flagged, not read. */
export const IMPORTED_SERIES_CAP = 300;

type AuditFields = Readonly<Record<string, string | number | boolean | null>>;

type AuditSummary = Readonly<{ result: AuditFields; rowCount: number }>;

/** Never used for a refusal (the wrapper writes its code); here for the types. */
const NOTHING_READ: AuditSummary = { result: {}, rowCount: 0 };

/** Audit `result` for a call that threw: a fixed name, never the message. */
export const IMPORTED_TOOL_FAILED = { error: "imported-tool-failed" } as const;

const auditedImported = async <T>(
  deps: ImportedToolDeps,
  tool: string,
  args: AuditFields,
  work: () => Promise<T>,
  summarise: (result: T) => AuditSummary,
): Promise<T> => {
  const append = (result: AuditFields, rowCount: number) =>
    deps.ports.appendAudit({
      actor: deps.scope.actor,
      sessionId: deps.scope.sessionId,
      subjectRef: null,
      tool,
      args,
      result,
      rowCount,
    });
  const result = await work().catch(async (error: unknown) => {
    await append(IMPORTED_TOOL_FAILED, 0);
    throw error;
  });
  if (isToolRefusal(result)) {
    await append({ code: result.code }, 0);
  } else {
    const summary = summarise(result);
    await append(summary.result, summary.rowCount);
  }
  return result;
};

const refusedByPolicy = (deps: ImportedToolDeps): ImportedRefusal | null => {
  const decision = deps.permit();
  return decision.ok ? null : importedNotPermitted(decision.reason);
};

const datasetExists = async (deps: ImportedToolDeps, datasetId: string) =>
  (await deps.ports.listDatasets()).some((dataset) => dataset.id === datasetId);

export type ImportedDatasetsResult = Readonly<{
  datasets: readonly ImportedDatasetEntry[];
  n_series: number;
  /** True when the person has more than IMPORTED_SERIES_CAP series; the rest are not listed. */
  more_series: boolean;
}>;

export const runImportedDatasets = (
  deps: ImportedToolDeps,
  _input: z.infer<typeof importedDatasetsInput>,
): Promise<ImportedDatasetsResult | ImportedRefusal> =>
  auditedImported<ImportedDatasetsResult | ImportedRefusal>(
    deps,
    IMPORTED_DATASETS_TOOL,
    {},
    async () => {
      const refused = refusedByPolicy(deps);
      if (refused !== null) return refused;
      const datasets = await deps.ports.listDatasets();
      const groups = await deps.ports.listSeries(IMPORTED_SERIES_CAP + 1);
      const listed = seriesListing(datasets, groups.slice(0, IMPORTED_SERIES_CAP));
      return {
        datasets: listed,
        n_series: listed.reduce((total, dataset) => total + dataset.series.length, 0),
        more_series: groups.length > IMPORTED_SERIES_CAP,
      };
    },
    (result) =>
      "datasets" in result
        ? {
            result: { datasets: result.datasets.length, series: result.n_series },
            rowCount: result.datasets.length,
          }
        : NOTHING_READ,
  );

export type ImportedReading = Readonly<{
  loinc: string;
  name: string;
  value: number;
  unit: string;
  effective_at: string;
  /** `year` or `month` means the file gave no day: `2024-03` is stored as 1 March. */
  effective_precision: string;
  dataset_id: string;
}>;

export type ImportedLatestResult = Readonly<{
  rows: readonly ImportedReading[];
  codes_without_rows: readonly string[];
}>;

export const runImportedLatest = (
  deps: ImportedToolDeps,
  input: z.infer<typeof importedLatestInput>,
): Promise<ImportedLatestResult | ImportedRefusal> =>
  auditedImported<ImportedLatestResult | ImportedRefusal>(
    deps,
    IMPORTED_LATEST_TOOL,
    { codes: input.loinc.length, dataset_id: input.dataset_id ?? null },
    async () => {
      const refused = refusedByPolicy(deps);
      if (refused !== null) return refused;
      const datasetId = input.dataset_id ?? null;
      if (datasetId !== null && !(await datasetExists(deps, datasetId))) {
        return datasetNotFound(datasetId);
      }
      const rows = await deps.ports.findLatest({ codes: input.loinc, datasetId });
      const picked = newestPerCode(rows, input.loinc);
      if (picked.readings.length === 0) return importedNoRows(input.loinc);
      return {
        rows: picked.readings.map((row) => ({
          loinc: row.code ?? "",
          name: row.display,
          value: row.value,
          unit: row.unit,
          effective_at: row.effectiveAt.toISOString(),
          effective_precision: row.effectivePrecision,
          dataset_id: row.datasetId,
        })),
        codes_without_rows: picked.codesWithoutRows,
      };
    },
    (result) =>
      "rows" in result
        ? {
            result: {
              rows: result.rows.length,
              without: result.codes_without_rows.length,
            },
            rowCount: result.rows.length,
          }
        : NOTHING_READ,
  );

export type ImportedTrendResult = Readonly<{
  dataset_id: string;
  loinc: string | null;
  name: string | null;
  unit: string | null;
  n: number;
  first_at: string | null;
  last_at: string | null;
  slope_per_day: number | null;
  slope_unit: string | null;
  fitted_first: number | null;
  fitted_last: number | null;
}>;

export const runImportedTrend = (
  deps: ImportedToolDeps,
  input: z.infer<typeof importedTrendInput>,
): Promise<ImportedTrendResult | ImportedRefusal | RowCapExceeded> =>
  auditedImported<ImportedTrendResult | ImportedRefusal | RowCapExceeded>(
    deps,
    IMPORTED_TREND_TOOL,
    {
      dataset_id: input.dataset_id,
      by: input.loinc === undefined ? "name" : "loinc",
      start: input.start,
      end: input.end,
    },
    async () => {
      const refused = refusedByPolicy(deps);
      if (refused !== null) return refused;
      if (input.loinc !== undefined && input.name !== undefined) {
        return seriesNotCombined(input.loinc, input.name);
      }
      if (!(await datasetExists(deps, input.dataset_id))) {
        return datasetNotFound(input.dataset_id);
      }
      const series = { loinc: input.loinc ?? null, name: input.name ?? null };
      const rows = await deps.ports.findSeries({
        datasetId: input.dataset_id,
        code: series.loinc,
        name: series.loinc === null ? series.name : null,
        start: windowStartDate(input.start),
        end: windowEndDate(input.end),
        take: ANALYTICS_ROW_CAP + 1,
      });
      if (rows.length > ANALYTICS_ROW_CAP) return ROW_CAP_EXCEEDED;
      const units = storedUnits(rows);
      if (units.length > 1) return importedMixedUnits(series, units);
      const nPartial = partialDateCount(rows);
      if (nPartial > 0) return partialDates(series, nPartial);
      const unit = units[0] ?? null;
      const fit = olsSlopePerDay(
        rows.map((row) => ({ at: row.effectiveAt, value: row.value })),
      );
      const first = rows.at(0);
      const last = rows.at(-1);
      const names = [...new Set(rows.map((row) => row.display))].sort();
      return {
        dataset_id: input.dataset_id,
        loinc: series.loinc,
        name: series.name ?? names[0] ?? null,
        unit,
        n: rows.length,
        first_at: first ? first.effectiveAt.toISOString() : null,
        last_at: last ? last.effectiveAt.toISOString() : null,
        slope_per_day: fit?.slopePerDay ?? null,
        slope_unit: unit === null ? null : `${unit}/d`,
        fitted_first: fit?.fittedFirst ?? null,
        fitted_last: fit?.fittedLast ?? null,
      };
    },
    (result) =>
      "n" in result ? { result: { n: result.n }, rowCount: result.n } : NOTHING_READ,
  );

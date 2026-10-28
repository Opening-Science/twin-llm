import "server-only";

import {
  defaultQueryToolPorts,
  type ObservationRecord,
  type QueryToolPorts,
  toNumber,
} from "./ports";
import { ANALYTICS_ROW_CAP, isToolRefusal, ROW_CAP_EXCEEDED } from "./refusals";
import { subjectRowInScope, type SessionScope } from "./scope";
import { windowEndDate, windowStartDate } from "./schemas";

/**
 * What every query tool shares: the audit wrapper, the scope check, the row
 * shape and the windowed read. Split out of tools.ts; tools.ts is the public index.
 */
export type ObservationRow = {
  readonly subject_ref: string;
  readonly loinc: string;
  readonly display: string;
  readonly value: number;
  readonly unit_ucum: string;
  readonly effective_at: string;
};

export const asIso = (value: Date): string => value.toISOString();

export const mapRow = (row: {
  subjectRef: string;
  loinc: string;
  display: string;
  value: unknown;
  unitUcum: string;
  effectiveAt: Date;
}): ObservationRow => ({
  subject_ref: row.subjectRef,
  loinc: row.loinc,
  display: row.display,
  value: toNumber(row.value),
  unit_ucum: row.unitUcum,
  effective_at: asIso(row.effectiveAt),
});

/** Audit `result` for a call that threw: a fixed name, never the error message. */
export const QUERY_TOOL_FAILED = { error: "query-tool-failed" } as const;

export const audited = async <T>(
  scope: SessionScope,
  tool: string,
  args: unknown,
  subjectRef: string | null,
  work: () => Promise<T>,
  rowCountOf: (result: T) => number,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<T> => {
  // A call that throws (database down, a bad decimal) still happened, so it
  // gets an audit row with 0 rows before the error goes back to the caller.
  const result = await work().catch(async (error: unknown) => {
    await ports.appendAudit({
      actor: scope.actor,
      sessionId: scope.sessionId,
      subjectRef,
      tool,
      args,
      result: QUERY_TOOL_FAILED,
      rowCount: 0,
    });
    throw error;
  });
  await ports.appendAudit({
    actor: scope.actor,
    sessionId: scope.sessionId,
    subjectRef,
    tool,
    args,
    result,
    // A refusal is never data, so it can never make an answer look supported.
    rowCount: isToolRefusal(result) ? 0 : rowCountOf(result),
  });
  return result;
};

export const subjectInScope = async (
  scope: SessionScope,
  subjectRef: string,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<boolean> => {
  if (scope.mode !== "synthetic") return false;
  return subjectRowInScope(scope, await ports.findSubject(subjectRef));
};

export const distinctUnits = (rows: readonly { readonly unitUcum: string }[]): string[] =>
  [...new Set(rows.map((row) => row.unitUcum))].sort();

export type TimeWindow = Readonly<{ start: string; end: string }>;

/** One capped read; a window over the cap is refused rather than cut short. */
export const readWindow = async (
  ports: QueryToolPorts,
  subjectRef: string,
  loinc: readonly string[],
  window: TimeWindow,
): Promise<readonly ObservationRecord[] | typeof ROW_CAP_EXCEEDED> => {
  const rows = await ports.findObservations({
    subjectRef,
    loinc,
    start: windowStartDate(window.start),
    end: windowEndDate(window.end),
    take: ANALYTICS_ROW_CAP + 1,
  });
  return rows.length > ANALYTICS_ROW_CAP ? ROW_CAP_EXCEEDED : rows;
};

export const valuesOf = (rows: readonly ObservationRecord[]): number[] =>
  rows.map((row) => row.value);

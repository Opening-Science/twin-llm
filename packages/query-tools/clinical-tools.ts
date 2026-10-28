import "server-only";

import {
  type ClinicalQuery,
  defaultQueryToolPorts,
  findConditionsInDatabase,
  findMedicationRequestsInDatabase,
  type QueryToolPorts,
} from "./ports";
import {
  isToolRefusal,
  mixedUnits,
  type ToolRefusal,
  noEvent,
  noRecords,
  noRows,
  recordCapExceeded,
} from "./refusals";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import type {
  conditionsTimelineInput,
  medicationsTimelineInput,
  valuesAroundEventInput,
} from "./schemas";
import { windowEndDate, windowStartDate } from "./schemas";
import { type WindowSummary } from "./stats";
import { eventWindows, firstDated } from "./event-windows";
import type { z } from "zod";
import {
  CLINICAL_ROW_CAP,
  conditionsTimeline,
  type ConditionsTimeline,
  medicationsTimeline,
  type MedicationsTimeline,
} from "./clinical-timeline";
import { audited, subjectInScope, distinctUnits, readWindow } from "./tool-core";
import { summarise, delta } from "./warehouse-tools";

/** Conditions, medication requests, and readings around one of them (tools.ts re-exports these). */
export type ConditionsTimelineInput = z.infer<typeof conditionsTimelineInput>;
export type MedicationsTimelineInput = z.infer<typeof medicationsTimelineInput>;

export type TimelineEcho = Readonly<{
  subject_ref: string;
  start: string;
  end: string;
  /** The filters as asked, null when not given. */
  status: string | null;
  code: string | null;
}>;

export type ConditionsTimelineResult = TimelineEcho & ConditionsTimeline;
export type MedicationsTimelineResult = TimelineEcho & MedicationsTimeline;

export const clinicalQuery = (
  input: Readonly<{
    subject_ref: string;
    start: string;
    end: string;
    status?: string;
    code?: string;
  }>,
): ClinicalQuery => ({
  subjectRef: input.subject_ref,
  start: windowStartDate(input.start),
  end: windowEndDate(input.end),
  ...(input.status === undefined ? {} : { status: input.status }),
  ...(input.code === undefined ? {} : { code: input.code }),
  take: CLINICAL_ROW_CAP + 1,
});

export const echo = (
  input: Readonly<{
    subject_ref: string;
    start: string;
    end: string;
    status?: string;
    code?: string;
  }>,
): TimelineEcho => ({
  subject_ref: input.subject_ref,
  start: input.start,
  end: input.end,
  status: input.status ?? null,
  code: input.code ?? null,
});

/**
 * `conditions_timeline`: scope first, one fixed capped read of the subject's
 * conditions overlapping the window, the ordering and counts in
 * `conditionsTimeline` (clinical-timeline.ts). None is refused with NO_ROWS and
 * its reason; over the cap with ROW_CAP_EXCEEDED.
 */
export const runConditionsTimeline = (
  scope: SessionScope,
  input: ConditionsTimelineInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<ConditionsTimelineResult | ToolRefusal> =>
  audited<ConditionsTimelineResult | ToolRefusal>(
    scope,
    "conditions_timeline",
    input,
    input.subject_ref,
    async () => {
      if (!(await subjectInScope(scope, input.subject_ref, ports))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      const find = ports.findConditions ?? findConditionsInDatabase;
      const rows = await find(clinicalQuery(input));
      if (rows.length > CLINICAL_ROW_CAP) return recordCapExceeded(CLINICAL_ROW_CAP);
      if (rows.length === 0) return noRecords("condition", input);
      return { ...echo(input), ...conditionsTimeline(rows) };
    },
    (result) => ("n" in result ? result.n : 0),
    ports,
  );

/**
 * `medications_timeline`: scope first, one fixed capped read of the subject's
 * medication requests authored in the window, the ordering and counts in
 * `medicationsTimeline`. Dosage is the record's own text or null; nothing is
 * added to it.
 */
export const runMedicationsTimeline = (
  scope: SessionScope,
  input: MedicationsTimelineInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<MedicationsTimelineResult | ToolRefusal> =>
  audited<MedicationsTimelineResult | ToolRefusal>(
    scope,
    "medications_timeline",
    input,
    input.subject_ref,
    async () => {
      if (!(await subjectInScope(scope, input.subject_ref, ports))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      const find = ports.findMedicationRequests ?? findMedicationRequestsInDatabase;
      const rows = await find(clinicalQuery(input));
      if (rows.length > CLINICAL_ROW_CAP) return recordCapExceeded(CLINICAL_ROW_CAP);
      if (rows.length === 0) return noRecords("medication request", input);
      return { ...echo(input), ...medicationsTimeline(rows) };
    },
    (result) => ("n" in result ? result.n : 0),
    ports,
  );

export type ValuesAroundEventInput = z.infer<typeof valuesAroundEventInput>;

export type ValuesAroundEventResult = Readonly<{
  loinc: string;
  unit: string | null;
  event: Readonly<{
    kind: "condition" | "medication";
    code_system: string;
    code: string;
    display: string;
    /** The first recorded onset or request of this code. */
    at: string;
    /** Dated records of this code, the first one included. */
    n_records: number;
  }>;
  before: WindowSummary;
  after: WindowSummary;
  delta_after_minus_before: Readonly<{
    mean: number | null;
    median: number | null;
    min: number | null;
    max: number | null;
  }>;
}>;

/** Every record of a subject, whatever its dates: the event is looked up, not windowed. */
export const ALL_TIME = {
  start: "1900-01-01T00:00:00Z",
  end: "2100-01-01T00:00:00Z",
} as const;

/**
 * `values_around_event`: the first dated record of one condition or medication
 * code, then the LOINC's readings in the window before it and the window from
 * it on, summarised as `compare_windows` does. Before and after, never cause.
 */
export const runValuesAroundEvent = (
  scope: SessionScope,
  input: ValuesAroundEventInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<ValuesAroundEventResult | ToolRefusal> =>
  audited<ValuesAroundEventResult | ToolRefusal>(
    scope,
    "values_around_event",
    input,
    input.subject_ref,
    async () => {
      if (!(await subjectInScope(scope, input.subject_ref, ports))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      const query = clinicalQuery({
        subject_ref: input.subject_ref,
        ...ALL_TIME,
        code: input.event_code,
      });
      type EventRecord = Readonly<{
        id: string;
        codeSystem: string;
        code: string;
        display: string;
        when: Date | null;
      }>;
      const records: readonly EventRecord[] =
        input.event_kind === "condition"
          ? (await (ports.findConditions ?? findConditionsInDatabase)(query)).map(
              (row) => ({ ...row, when: row.onsetAt }),
            )
          : (
              await (ports.findMedicationRequests ?? findMedicationRequestsInDatabase)(
                query,
              )
            ).map((row) => ({ ...row, when: row.authoredAt }));
      if (records.length > CLINICAL_ROW_CAP) return recordCapExceeded(CLINICAL_ROW_CAP);
      const first = firstDated(records, (record) => record.when);
      if (first === null) {
        return noEvent(
          input.event_kind === "condition" ? "condition" : "medication request",
          input.event_code,
        );
      }
      const windows = eventWindows(first.at, input.days_before, input.days_after);
      const codes = [input.loinc];
      const rowsBefore = await readWindow(
        ports,
        input.subject_ref,
        codes,
        windows.before,
      );
      if (isToolRefusal(rowsBefore)) return rowsBefore;
      const rowsAfter = await readWindow(ports, input.subject_ref, codes, windows.after);
      if (isToolRefusal(rowsAfter)) return rowsAfter;
      if (rowsBefore.length + rowsAfter.length === 0) {
        return noRows(input.loinc, null);
      }
      const units = distinctUnits([...rowsBefore, ...rowsAfter]);
      if (units.length > 1) return mixedUnits(input.loinc, units);
      const before = summarise(windows.before, rowsBefore);
      const after = summarise(windows.after, rowsAfter);
      return {
        loinc: input.loinc,
        unit: units[0] ?? null,
        event: {
          kind: input.event_kind,
          code_system: first.codeSystem,
          code: first.code,
          display: first.display,
          at: first.at.toISOString(),
          n_records: records.filter((record) => record.when !== null).length,
        },
        before,
        after,
        delta_after_minus_before: {
          mean: delta(before.mean, after.mean),
          median: delta(before.median, after.median),
          min: delta(before.min, after.min),
          max: delta(before.max, after.max),
        },
      };
    },
    (result) => ("before" in result ? result.before.n + result.after.n : 0),
    ports,
  );

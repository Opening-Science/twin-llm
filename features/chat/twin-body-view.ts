import "server-only";

import {
  type ChatView,
  type TwinBodySpec,
  twinBodyView,
} from "@/infrastructure/chat-view";
import {
  isTwinFocusId,
  type TwinFocusId,
  twinFocus,
} from "@/packages/anatomy/twin-focus";
import { focusLoincs, focusOrganStatus } from "@/packages/biomarkers/focus-state";
import type { MarkerValue, OrganStatus } from "@/packages/biomarkers/organ-map";
import type { PopulationContext } from "@/packages/biomarkers/population";
import type { ObservationRecord, QueryToolPorts } from "@/packages/query-tools/ports";
import { isToolRefusal, type ToolRefusal } from "@/packages/query-tools/refusals";
import {
  SUBJECT_SCOPE_VIOLATION,
  type SessionScope,
  subjectRowInScope,
} from "@/packages/query-tools/scope";
import { audited, readWindow } from "@/packages/query-tools/tool-core";

/**
 * `show_view` with kind `twin.body`: the twin focused on an organ or system,
 * with the range position of each mapped organ under it. With a synthetic
 * subject the mapped markers are read in the window (one capped read) and
 * placed by `organStatus` from `packages/biomarkers`, the same table the twin's
 * environment uses. Without a window the read covers the subject's whole record,
 * still one capped read, so each marker's latest reading places its organ.
 * Without a subject nothing is read and the body is shown with no positions. Either way the call is one audit row (`twin_body`), so the view
 * has a source like every other.
 */

export const TWIN_BODY_AUDIT_TOOL = "twin_body";

type Window = Readonly<{ start: string; end: string }>;

export type TwinBodyInput = Readonly<{
  focus: TwinFocusId;
  subject: string | null;
  /** Null: the subject's whole record, so each marker's latest reading. */
  window: Window | null;
}>;

export type TwinBodyState = Readonly<{
  organs: readonly OrganStatus[];
  n: number;
}>;

/** The newest reading per code; rows come oldest first, so the last one wins. */
export const latestValues = (rows: readonly ObservationRecord[]): MarkerValue[] => [
  ...new Map(
    rows.map((row) => [
      row.loinc,
      { loinc: row.loinc, value: row.value, unitUcum: row.unitUcum },
    ]),
  ).values(),
];

/** Only the stored sex is used; without an age, intervals that need one place nothing. */
export const populationOf = (sex: string | null | undefined): PopulationContext =>
  sex === "female" || sex === "male" ? { sex } : {};

const NO_STATE: TwinBodyState = { organs: [], n: 0 };

/**
 * The span read when no window is asked for: wider than any stored record, so
 * the read is the subject's whole record of the mapped codes.
 */
export const WHOLE_RECORD: Window = { start: "1900-01-01", end: "2999-12-31" };

/** The organ state of the focus for one subject, read and audited as `twin_body`. */
export const runTwinBodyState = (
  scope: SessionScope,
  input: TwinBodyInput,
  ports: QueryToolPorts,
): Promise<TwinBodyState | ToolRefusal> =>
  audited<TwinBodyState | ToolRefusal>(
    scope,
    TWIN_BODY_AUDIT_TOOL,
    { focus: input.focus, subject_ref: input.subject, ...(input.window ?? {}) },
    input.subject,
    async () => {
      if (input.subject === null) return NO_STATE;
      if (scope.mode !== "synthetic") return SUBJECT_SCOPE_VIOLATION;
      const subject = await ports.findSubject(input.subject);
      if (!subjectRowInScope(scope, subject)) return SUBJECT_SCOPE_VIOLATION;
      const loincs = focusLoincs(input.focus);
      if (loincs.length === 0) return NO_STATE;
      const rows = await readWindow(
        ports,
        input.subject,
        loincs,
        input.window ?? WHOLE_RECORD,
      );
      if (isToolRefusal(rows)) return rows;
      return {
        organs: focusOrganStatus(
          input.focus,
          latestValues(rows),
          populationOf(subject?.sex),
        ),
        n: rows.length,
      };
    },
    (result) => ("n" in result ? result.n : 0),
    ports,
  );

/** The spec of a twin view from its state; labels come from the tables, never the model. */
export const twinBodySpecOf = (
  input: TwinBodyInput & Readonly<{ body: TwinBodySpec["body"] }>,
  state: TwinBodyState,
): TwinBodySpec => ({
  focus: input.focus,
  label: twinFocus(input.focus).label,
  body: input.body,
  subject: input.subject,
  window: input.window,
  unit: null,
  organs: state.organs.map((row) => ({
    organ: row.organ,
    label: isTwinFocusId(row.organ) ? twinFocus(row.organ).label : row.organ,
    position: row.position,
    marker: row.label,
    loinc: row.loinc,
  })),
  n: state.n,
});

export const buildTwinBodyView = (
  input: TwinBodyInput & Readonly<{ body: TwinBodySpec["body"] }>,
  state: TwinBodyState,
  sourceAuditIds: readonly string[],
): ChatView => twinBodyView({ spec: twinBodySpecOf(input, state), sourceAuditIds });

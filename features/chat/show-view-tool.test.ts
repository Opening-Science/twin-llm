import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";
import type { ObservationQuery, QueryToolPorts } from "@/packages/query-tools/ports";

import { modelNoteOf, runShowView } from "./show-view-tool";

const SCOPE = { actor: "test", sessionId: "turn-view", mode: "synthetic" } as const;
const PERSONAL = { ...SCOPE, mode: "personal" } as const;
const NO_WEARABLES = { oura: null, whoop: null, googleHealth: null, vitronic: null };
const WINDOW = { start: "2026-10-01", end: "2026-10-31" };

const fakePorts = (
  rows: Awaited<ReturnType<QueryToolPorts["findObservations"]>>,
  appendReturns?: unknown,
) => {
  const audits: AppendInput[] = [];
  const queries: ObservationQuery[] = [];
  const ports: QueryToolPorts = {
    findSubject: async () => ({
      isSynthetic: true,
      cohortId: "open-twin-synthea-trimmed-3",
    }),
    findObservations: async (query) => {
      queries.push(query);
      return rows;
    },
    appendAudit: async (input) => {
      audits.push(input);
      return appendReturns ?? { seq: BigInt(40 + audits.length), hash: "h" };
    },
  };
  return { ports, audits, queries };
};

const row = (day: string, value: number) => ({
  loinc: "8867-4",
  display: "Heart rate",
  value,
  unitUcum: "/min",
  effectiveAt: new Date(`2026-10-${day}T08:00:00.000Z`),
});

const input = (measure: string, subject?: string) => ({
  kind: "chart.timeseries" as const,
  measure,
  window: WINDOW,
  ...(subject ? { subject } : {}),
});

describe("show_view with a LOINC measure", () => {
  test("every point is a row of the audited query, and the view names that audit row", async () => {
    const { ports, audits, queries } = fakePorts([row("02", 61), row("09", 64)]);
    const view = await runShowView(
      { scope: SCOPE, ports, wearables: NO_WEARABLES, cohortRecords: true },
      input("8867-4", "synthetic-subject-1"),
    );
    expect(view).toEqual({
      id: "view-41",
      kind: "chart.timeseries",
      title: "Heart rate, 2026-10-01 to 2026-10-31",
      spec: {
        measure: "8867-4",
        label: "Heart rate",
        unit: "/min",
        window: WINDOW,
        subject: "synthetic-subject-1",
        points: [
          { at: "2026-10-02T08:00:00.000Z", value: 61 },
          { at: "2026-10-09T08:00:00.000Z", value: 64 },
        ],
      },
      sourceAuditIds: ["41"],
    });
    expect(queries.map((query) => query.loinc)).toEqual([["8867-4"]]);
    expect(audits.map((audit) => [audit.tool, audit.subjectRef, audit.rowCount])).toEqual(
      [["timeseries", "synthetic-subject-1", 2]],
    );
  });

  test("no rows is a view with no points, never a zero", async () => {
    const { ports } = fakePorts([]);
    const view = await runShowView(
      { scope: SCOPE, ports, wearables: NO_WEARABLES, cohortRecords: true },
      input("8867-4", "synthetic-subject-1"),
    );
    expect("spec" in view ? view.spec.points : null).toEqual([]);
    expect(modelNoteOf(view)).toEqual({
      shown: true,
      view_id: "view-41",
      title: "8867-4, 2026-10-01 to 2026-10-31",
      readings: 0,
      unit: null,
      note: "no readings in this window; the view says so and draws no chart",
    });
  });

  test("refuses without reading when cohort records are off or the subject is missing", async () => {
    const { ports, audits } = fakePorts([row("02", 61)]);
    const deps = { scope: SCOPE, ports, wearables: NO_WEARABLES, cohortRecords: true };
    expect(
      await runShowView({ ...deps, cohortRecords: false }, input("8867-4", "s-1")),
    ).toMatchObject({ code: "COHORT_TOOLS_OFF" });
    expect(await runShowView(deps, input("8867-4"))).toMatchObject({
      code: "SUBJECT_REQUIRED",
    });
    expect(audits).toEqual([]);
  });

  test("a personal session is refused the cohort, as the query tools are", async () => {
    const { ports } = fakePorts([row("02", 61)]);
    expect(
      await runShowView(
        { scope: PERSONAL, ports, wearables: NO_WEARABLES, cohortRecords: true },
        input("8867-4", "synthetic-subject-1"),
      ),
    ).toEqual({
      code: "SUBJECT_SCOPE_VIOLATION",
      error: "subject_ref is not in this session scope",
    });
  });

  test("a read whose audit row has no seq draws nothing", async () => {
    const { ports } = fakePorts([row("02", 61)], { ok: true });
    expect(
      await runShowView(
        { scope: SCOPE, ports, wearables: NO_WEARABLES, cohortRecords: true },
        input("8867-4", "synthetic-subject-1"),
      ),
    ).toMatchObject({ code: "NOT_AUDITED" });
  });
});

describe("show_view with a wearable key", () => {
  const metric = (key: string, value: number, date: string) => ({
    key,
    label: "Synthetic",
    value,
    date,
  });
  const oura = {
    window: { startDate: "2026-09-25", endDate: "2026-10-05" },
    narrative: "Synthetic.",
    metrics: [
      metric("sleep.score.2026-09-28", 70, "2026-09-28"),
      metric("sleep.score.2026-10-02", 81, "2026-10-02"),
      metric("sleep.score.2026-10-01", 77, "2026-10-01"),
      metric("sleep.score.nap.2026-10-01", 20, "2026-10-01"),
      metric("readiness.score.2026-10-01", 90, "2026-10-01"),
    ],
  };

  test("draws the user's readings in the window, in order, under one audit row", async () => {
    const { ports, audits } = fakePorts([]);
    const view = await runShowView(
      {
        scope: PERSONAL,
        ports,
        wearables: { ...NO_WEARABLES, oura },
        cohortRecords: true,
      },
      input("sleep.score"),
    );
    expect("spec" in view ? view.spec.points : view).toEqual([
      { at: "2026-10-01T00:00:00.000Z", value: 77 },
      { at: "2026-10-02T00:00:00.000Z", value: 81 },
    ]);
    expect("sourceAuditIds" in view ? view.sourceAuditIds : null).toEqual(["41"]);
    expect(audits.map((audit) => [audit.tool, audit.subjectRef, audit.rowCount])).toEqual(
      [["wearable_series", null, 2]],
    );
  });

  test("without a snapshot the view has no points", async () => {
    const { ports } = fakePorts([]);
    const view = await runShowView(
      { scope: SCOPE, ports, wearables: NO_WEARABLES, cohortRecords: true },
      input("sleep.score"),
    );
    expect("spec" in view ? view.spec.points : view).toEqual([]);
  });
});

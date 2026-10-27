import { describe, expect, test } from "bun:test";

import { toChatView } from "@/infrastructure/chat-view";
import type { AppendInput } from "@/packages/audit/append";
import type {
  ObservationQuery,
  ObservationRecord,
  QueryToolPorts,
} from "@/packages/query-tools/ports";

import { modelNoteOf, runShowView } from "./show-view-tool";

/**
 * `chart.compare`, `biomarker.card` and `table` through `show_view`: every
 * number in the view is one the audited reads returned or the server
 * computed from them, checked here with exact values.
 */

const SCOPE = { actor: "test", sessionId: "turn-kinds", mode: "synthetic" } as const;
const PERSONAL = { ...SCOPE, mode: "personal" } as const;
const NO_WEARABLES = { oura: null, whoop: null, googleHealth: null, vitronic: null };
const SUBJECT = "synthetic-subject-1";

/** Ports that answer each query with the rows inside its window, as the database would. */
const fakePorts = (rows: readonly ObservationRecord[]) => {
  const audits: AppendInput[] = [];
  const queries: ObservationQuery[] = [];
  const ports: QueryToolPorts = {
    findSubject: async () => ({
      isSynthetic: true,
      cohortId: "open-twin-synthea-trimmed-3",
    }),
    findObservations: async (query) => {
      queries.push(query);
      return rows
        .filter(
          (row) =>
            query.loinc.includes(row.loinc) &&
            row.effectiveAt >= query.start &&
            row.effectiveAt <= query.end,
        )
        .slice(0, query.take);
    },
    appendAudit: async (input) => {
      audits.push(input);
      return { seq: BigInt(40 + audits.length), hash: "h" };
    },
  };
  return { ports, audits, queries };
};

const deps = (ports: QueryToolPorts) => ({
  scope: SCOPE,
  ports,
  wearables: NO_WEARABLES,
  cohortRecords: true,
});

const reading =
  (loinc: string, display: string, unitUcum: string) =>
  (day: string, value: number, id?: string): ObservationRecord => ({
    loinc,
    display,
    value,
    unitUcum,
    effectiveAt: new Date(`${day}T08:00:00.000Z`),
    ...(id ? { id } : {}),
  });

const sleep = reading("93832-4", "Sleep duration", "h");
const sodium = reading("2951-2", "Sodium", "mmol/L");
const cholesterol = reading("2093-3", "Cholesterol", "mg/dL");

const auditTrail = (audits: readonly AppendInput[]) =>
  audits.map((audit) => [audit.tool, audit.subjectRef, audit.rowCount]);

describe("chart.compare", () => {
  const rows = [
    sleep("2026-09-03", 7),
    sleep("2026-09-10", 6.5),
    sleep("2026-09-17", 7.5),
    sleep("2026-09-29", 6),
    sleep("2026-10-01", 6.5),
  ];

  test("n and means are compare_windows' own; the points are one read per window", async () => {
    const { ports, audits } = fakePorts(rows);
    const view = await runShowView(deps(ports), {
      kind: "chart.compare",
      measure: "93832-4",
      subject: SUBJECT,
      window: { start: "2026-09-28", end: "2026-10-04" },
      compare_with: { start: "2026-08-31", end: "2026-09-27" },
    });
    expect(view).toEqual({
      id: "view-41-42-43",
      kind: "chart.compare",
      title: "Sleep duration, 28 Sept 2026 – 4 Oct 2026 vs 31 Aug 2026 – 27 Sept 2026",
      spec: {
        measure: "93832-4",
        label: "Sleep duration",
        unit: "h",
        subject: SUBJECT,
        layout: "side-by-side",
        before: {
          start: "2026-08-31",
          end: "2026-09-27",
          n: 3,
          mean: 7,
          points: [
            { at: "2026-09-03T08:00:00.000Z", value: 7 },
            { at: "2026-09-10T08:00:00.000Z", value: 6.5 },
            { at: "2026-09-17T08:00:00.000Z", value: 7.5 },
          ],
        },
        after: {
          start: "2026-09-28",
          end: "2026-10-04",
          n: 2,
          mean: 6.25,
          points: [
            { at: "2026-09-29T08:00:00.000Z", value: 6 },
            { at: "2026-10-01T08:00:00.000Z", value: 6.5 },
          ],
        },
        meanDelta: -0.75,
      },
      sourceAuditIds: ["41", "42", "43"],
    });
    expect(auditTrail(audits)).toEqual([
      ["compare_windows", SUBJECT, 5],
      ["timeseries", SUBJECT, 3],
      ["timeseries", SUBJECT, 2],
    ]);
    expect(modelNoteOf(view)).toEqual({
      shown: true,
      view_id: "view-41-42-43",
      title: "Sleep duration, 28 Sept 2026 – 4 Oct 2026 vs 31 Aug 2026 – 27 Sept 2026",
      readings: 5,
      unit: "h",
    });
  });

  test("an empty earlier window has no mean and no difference, never 0", async () => {
    const { ports } = fakePorts(rows);
    const view = await runShowView(deps(ports), {
      kind: "chart.compare",
      measure: "93832-4",
      subject: SUBJECT,
      window: { start: "2026-09-28", end: "2026-10-04" },
      compare_with: { start: "2026-01-01", end: "2026-01-31" },
      layout: "overlaid",
    });
    expect(view.kind === "chart.compare" ? view.spec : view).toMatchObject({
      layout: "overlaid",
      before: { n: 0, mean: null, points: [] },
      after: { n: 2, mean: 6.25 },
      meanDelta: null,
    });
  });

  test("a wearable key gets the same summary of its own readings", async () => {
    const { ports, audits } = fakePorts([]);
    const metric = (date: string, value: number) => ({
      key: `sleep.score.${date}`,
      label: "Sleep score",
      value,
      date,
    });
    const oura = {
      window: { startDate: "2026-09-01", endDate: "2026-10-04" },
      narrative: "Synthetic.",
      metrics: [
        metric("2026-09-10", 80),
        metric("2026-09-20", 70),
        metric("2026-09-30", 72),
        metric("2026-10-02", 77),
      ],
    };
    const view = await runShowView(
      {
        scope: PERSONAL,
        ports,
        wearables: { ...NO_WEARABLES, oura },
        cohortRecords: true,
      },
      {
        kind: "chart.compare",
        measure: "sleep.score",
        window: { start: "2026-09-28", end: "2026-10-04" },
        compare_with: { start: "2026-08-31", end: "2026-09-27" },
      },
    );
    expect(view.kind === "chart.compare" ? view.spec : view).toMatchObject({
      label: "Sleep score",
      subject: null,
      before: { n: 2, mean: 75 },
      after: { n: 2, mean: 74.5 },
      meanDelta: -0.5,
    });
    expect(auditTrail(audits)).toEqual([
      ["wearable_series", null, 2],
      ["wearable_series", null, 2],
    ]);
  });

  test("without compare_with nothing is read", async () => {
    const { ports, audits } = fakePorts(rows);
    expect(
      await runShowView(deps(ports), {
        kind: "chart.compare",
        measure: "93832-4",
        subject: SUBJECT,
        window: { start: "2026-09-28", end: "2026-10-04" },
      }),
    ).toEqual({
      code: "COMPARE_WINDOW_REQUIRED",
      error: "chart.compare needs compare_with, the earlier window to set against window",
    });
    expect(audits).toEqual([]);
  });
});

describe("biomarker.card", () => {
  const WINDOW = { start: "2026-01-01", end: "2026-10-31" };

  test("the latest value against Anchor v3's sodium range, with trend's direction and n", async () => {
    const { ports, audits } = fakePorts([
      sodium("2026-02-01", 139),
      sodium("2026-05-01", 142),
      sodium("2026-08-01", 146),
    ]);
    const view = await runShowView(deps(ports), {
      kind: "biomarker.card",
      measure: "2951-2",
      subject: SUBJECT,
      window: WINDOW,
    });
    expect(view).toEqual({
      id: "view-41-42",
      kind: "biomarker.card",
      title: "Sodium, 1 Jan 2026 – 31 Oct 2026",
      spec: {
        measure: "2951-2",
        label: "Sodium",
        subject: SUBJECT,
        window: WINDOW,
        value: 146,
        unit: "mmol/L",
        at: "2026-08-01T08:00:00.000Z",
        n: 3,
        range: {
          low: 135,
          high: 145,
          unit: "mmol/L",
          population: "general_adult",
          source: "Anchor v3",
        },
        position: "above",
        dependsOn: [],
        trend: {
          n: 3,
          direction: "up",
          slopePerDay: expect.any(Number),
          slopeUnit: "mmol/L/d",
        },
      },
      sourceAuditIds: ["41", "42"],
    });
    // Days 0, 89 and 181 from 1 Feb: slope 634 / 16382 mmol/L a day.
    expect(
      view.kind === "biomarker.card" ? view.spec.trend.slopePerDay : null,
    ).toBeCloseTo(634 / 16382, 12);
    expect(auditTrail(audits)).toEqual([
      ["range_position", SUBJECT, 3],
      ["trend", SUBJECT, 3],
    ]);
  });

  test("a range that depends on age names it and gives no position", async () => {
    const { ports } = fakePorts([
      cholesterol("2026-03-01", 190),
      cholesterol("2026-04-01", 185),
    ]);
    const view = await runShowView(deps(ports), {
      kind: "biomarker.card",
      measure: "2093-3",
      subject: SUBJECT,
      window: WINDOW,
    });
    expect(view.kind === "biomarker.card" ? view.spec : view).toMatchObject({
      label: "Cholesterol",
      value: 185,
      range: null,
      position: null,
      dependsOn: ["age"],
      trend: { n: 2, direction: null, slopePerDay: null },
    });
  });

  test("a code without a published range is refused as range_position refuses it", async () => {
    const { ports, audits } = fakePorts([
      reading("8867-4", "Heart rate", "/min")("2026-03-01", 61),
    ]);
    expect(
      await runShowView(deps(ports), {
        kind: "biomarker.card",
        measure: "8867-4",
        subject: SUBJECT,
        window: WINDOW,
      }),
    ).toEqual({
      code: "NO_PUBLISHED_RANGE",
      error: "this code is not an Anchor v3 biomarker, so there is no published range",
      loinc: "8867-4",
    });
    expect(auditTrail(audits)).toEqual([["range_position", SUBJECT, 0]]);
  });

  test("a wearable key is refused before any read", async () => {
    const { ports, audits } = fakePorts([]);
    expect(
      await runShowView(
        { ...deps(ports), scope: PERSONAL },
        { kind: "biomarker.card", measure: "sleep.score", window: WINDOW },
      ),
    ).toMatchObject({ code: "LOINC_REQUIRED" });
    expect(audits).toEqual([]);
  });
});

describe("table", () => {
  const days = Array.from({ length: 120 }, (_, i) =>
    new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
  );

  test("the first 50 of 120 readings, columns chosen here, total kept", async () => {
    const { ports, audits } = fakePorts(
      days.map((day, i) => sleep(day, 6 + (i % 4) * 0.5)),
    );
    const view = await runShowView(deps(ports), {
      kind: "table",
      measure: "93832-4",
      subject: SUBJECT,
      window: { start: "2026-01-01", end: "2026-04-30" },
    });
    if (view.kind !== "table") throw new Error("expected a table");
    expect(view.title).toBe("Sleep duration, 1 Jan 2026 – 30 Apr 2026");
    expect(view.spec.columns).toEqual([
      { key: "at", label: "Date", format: "date" },
      { key: "value", label: "Value", format: "number" },
    ]);
    expect(view.spec.rows.length).toBe(50);
    expect(view.spec.rows.slice(0, 3)).toEqual([
      { at: "2026-01-01T08:00:00.000Z", value: 6 },
      { at: "2026-01-02T08:00:00.000Z", value: 6.5 },
      { at: "2026-01-03T08:00:00.000Z", value: 7 },
    ]);
    expect(view.spec.rows.at(-1)).toEqual({ at: "2026-02-19T08:00:00.000Z", value: 6.5 });
    expect(view.spec.total).toBe(120);
    expect(view.spec.unit).toBe("h");
    expect(auditTrail(audits)).toEqual([["timeseries", SUBJECT, 120]]);
    expect(modelNoteOf(view)).toMatchObject({ readings: 120 });
  });
});

describe("stored views", () => {
  test("each new kind reads back from its stored tool output unchanged", async () => {
    const { ports } = fakePorts([sodium("2026-02-01", 139), sodium("2026-05-01", 142)]);
    const card = await runShowView(deps(ports), {
      kind: "biomarker.card",
      measure: "2951-2",
      subject: SUBJECT,
      window: { start: "2026-01-01", end: "2026-10-31" },
    });
    const table = await runShowView(deps(ports), {
      kind: "table",
      measure: "2951-2",
      subject: SUBJECT,
      window: { start: "2026-01-01", end: "2026-10-31" },
    });
    const stored = JSON.parse(JSON.stringify([card, table])) as unknown[];
    expect(stored.map(toChatView)).toEqual([card, table]);
  });
});

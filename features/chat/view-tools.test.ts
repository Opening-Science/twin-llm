import { describe, expect, test } from "bun:test";

import { timeseriesView } from "@/infrastructure/chat-view";
import type { AppendInput } from "@/packages/audit/append";
import type { QueryToolPorts } from "@/packages/query-tools/ports";

import { type StoredAnswerRow, threadViewsOf } from "./thread-views";
import { modelNoteOf } from "./show-view-tool";
import {
  runListViews,
  runOpenView,
  VIEW_NOT_FOUND,
  type ViewToolDeps,
} from "./view-tools";

const cohortView = timeseriesView({
  spec: {
    measure: "8867-4",
    label: "Heart rate",
    unit: "/min",
    window: { start: "2026-10-01", end: "2026-10-31" },
    subject: "synthetic-subject-1",
    points: [
      { at: "2026-10-02T08:00:00.000Z", value: 61 },
      { at: "2026-10-09T08:00:00.000Z", value: 64 },
    ],
  },
  sourceAuditIds: ["41"],
});

const sleepView = timeseriesView({
  spec: {
    measure: "sleep.score",
    label: "Sleep score",
    unit: null,
    window: { start: "2026-10-01", end: "2026-10-03" },
    subject: null,
    points: [{ at: "2026-10-01T00:00:00.000Z", value: 77 }],
  },
  sourceAuditIds: ["52"],
});

const part = (seq: number, tool: string, output: unknown) => ({
  seq,
  tool,
  input: {},
  output,
  argsSha256: "a".repeat(64),
  resultSha256: "b".repeat(64),
  rowCount: null,
  at: "2026-10-20T10:00:00.000Z",
});

const rows: StoredAnswerRow[] = [
  {
    modelName: "Model A",
    toolParts: [
      part(1, "latest_by_loinc", { rows: [] }),
      part(2, "show_view", cohortView),
    ],
    responseDocument: null,
    completedAt: new Date("2026-10-20T10:00:00.000Z"),
  },
  {
    modelName: "Model B",
    toolParts: [
      part(1, "show_view", sleepView),
      part(2, "show_view", { code: "SUBJECT_REQUIRED", error: "x" }),
    ],
    responseDocument: null,
    completedAt: new Date("2026-10-21T10:00:00.000Z"),
  },
  { modelName: "Model C", toolParts: null, responseDocument: null, completedAt: null },
];

describe("threadViewsOf", () => {
  test("every view the thread's answers showed, newest first, refusals left out", () => {
    expect(threadViewsOf(rows)).toEqual([
      { view: sleepView, modelName: "Model B", at: "2026-10-21T10:00:00.000Z" },
      { view: cohortView, modelName: "Model A", at: "2026-10-20T10:00:00.000Z" },
    ]);
  });

  test("a reopened view counts once, at its newest showing", () => {
    const reopened: StoredAnswerRow = {
      modelName: "Model C",
      toolParts: [part(1, "open_view", cohortView)],
      responseDocument: null,
      completedAt: new Date("2026-10-22T10:00:00.000Z"),
    };
    expect(threadViewsOf([...rows, reopened]).map((entry) => entry.modelName)).toEqual([
      "Model C",
      "Model B",
    ]);
  });
});

const recording = () => {
  const audits: AppendInput[] = [];
  const ports: QueryToolPorts = {
    findSubject: async () => {
      throw new Error("open_view must not query");
    },
    findObservations: async () => {
      throw new Error("open_view must not query");
    },
    appendAudit: async (input) => {
      audits.push(input);
      return { seq: BigInt(90), hash: "h" };
    },
  };
  return { ports, audits };
};

const deps = (ports: QueryToolPorts, personal: boolean): ViewToolDeps => ({
  scope: { actor: "test", sessionId: "turn-9", mode: "personal" },
  ports,
  loadViews: async (sessionId) => (sessionId === "turn-9" ? threadViewsOf(rows) : []),
  personal,
});

describe("open_view", () => {
  test("re-emits the stored view unchanged, without a query, audited as a read of it", async () => {
    const { ports, audits } = recording();
    const output = await runOpenView(deps(ports, true), { id: cohortView.id });
    expect(output).toEqual(cohortView);
    expect(audits).toEqual([
      {
        actor: "test",
        sessionId: "turn-9",
        subjectRef: "synthetic-subject-1",
        tool: "open_view",
        args: { id: "view-41" },
        result: cohortView,
        rowCount: 2,
      },
    ]);
    expect(modelNoteOf(output)).toEqual({
      shown: true,
      view_id: "view-41",
      title: "Heart rate, 2026-10-01 to 2026-10-31",
      readings: 2,
      unit: "/min",
    });
  });

  test("an unknown id is refused with 0 rows", async () => {
    const { ports, audits } = recording();
    expect(await runOpenView(deps(ports, true), { id: "view-999" })).toEqual(
      VIEW_NOT_FOUND,
    );
    expect(audits.map((audit) => [audit.tool, audit.rowCount])).toEqual([
      ["open_view", 0],
    ]);
  });

  test("a synthetic request cannot reopen a wearable view", async () => {
    const { ports } = recording();
    expect(await runOpenView(deps(ports, false), { id: sleepView.id })).toEqual(
      VIEW_NOT_FOUND,
    );
  });
});

describe("list_views", () => {
  test("ids, titles, kinds, models and times; no points", async () => {
    const { ports, audits } = recording();
    const output = await runListViews(deps(ports, true), {});
    expect(output).toEqual({
      views: [
        {
          id: "view-52",
          title: "Sleep score, 2026-10-01 to 2026-10-03",
          kind: "chart.timeseries",
          model: "Model B",
          at: "2026-10-21T10:00:00.000Z",
        },
        {
          id: "view-41",
          title: "Heart rate, 2026-10-01 to 2026-10-31",
          kind: "chart.timeseries",
          model: "Model A",
          at: "2026-10-20T10:00:00.000Z",
        },
      ],
    });
    expect(audits.map((audit) => [audit.tool, audit.subjectRef, audit.rowCount])).toEqual(
      [["list_views", null, 2]],
    );
  });

  test("a synthetic request lists only cohort views", async () => {
    const { ports } = recording();
    const output = await runListViews(deps(ports, false), {});
    expect(output.views.map((view) => view.id)).toEqual(["view-41"]);
  });
});

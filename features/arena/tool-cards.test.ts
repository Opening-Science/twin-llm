import { describe, expect, test } from "bun:test";

import { timeseriesView } from "@/infrastructure/chat-view";
import type { ChatUIMessage } from "@/infrastructure/model-response-metrics";

import { toolActivity } from "./answer-stream";
import { toSavedResponseState } from "./saved-response-state";
import { rowCountOf, rowsLabel, toolArgs, toolCard, toolTitle } from "./tool-cards";

const view = timeseriesView({
  spec: {
    measure: "sleep.score",
    label: "Sleep score",
    unit: null,
    window: { start: "2026-10-01", end: "2026-10-03" },
    subject: null,
    points: [
      { at: "2026-10-01T00:00:00.000Z", value: 71 },
      { at: "2026-10-02T00:00:00.000Z", value: 74 },
    ],
  },
  sourceAuditIds: ["41"],
});

describe("toolTitle", () => {
  test("known tools read in plain words, others from their name", () => {
    expect(toolTitle("show_view")).toBe("Drew a chart");
    expect(toolTitle("list_views")).toBe("Listed this thread's charts");
    expect(toolTitle("open_view")).toBe("Reopened a chart");
    expect(toolTitle("summary_stats")).toBe("Summarised a measure");
    expect(toolTitle("guideline_search")).toBe("Searched guidelines");
    expect(toolTitle("gbd_population")).toBe("Looked up population data");
    expect(toolTitle("some_new_tool")).toBe("Some new tool");
  });
});

describe("toolArgs", () => {
  test("a chart's measure, kind and window, dates as dates", () => {
    expect(
      toolArgs({
        kind: "chart.timeseries",
        measure: "sleep.score",
        window: { start: "2026-10-01", end: "2026-10-31T23:59:59Z" },
      }),
    ).toEqual([
      { label: "Measure", value: "sleep.score" },
      { label: "Kind", value: "chart.timeseries" },
      { label: "Window", value: "1 Oct 2026 – 31 Oct 2026" },
    ]);
  });

  test("a cohort query's codes, window, subject and limit", () => {
    expect(
      toolArgs({
        subject_ref: "synthetic-subject-1",
        loinc: ["8867-4", "8480-6"],
        start: "2026-01-01",
        end: "2026-02-01",
        limit: 200,
      }),
    ).toEqual([
      { label: "Measure", value: "8867-4, 8480-6" },
      { label: "Window", value: "1 Jan 2026 – 1 Feb 2026" },
      { label: "Subject", value: "synthetic-subject-1" },
      { label: "Limit", value: "200" },
    ]);
  });

  test("a long search query is clipped; unnamed fields are dropped", () => {
    const [search, ...rest] = toolArgs({ query: "q".repeat(120), k: 5, extra: "x" });
    expect(search).toEqual({ label: "Search", value: `${"q".repeat(79)}…` });
    expect(rest).toEqual([]);
    expect(toolArgs(null)).toEqual([]);
  });
});

describe("rowCountOf", () => {
  test("counts rows the way the audit row does", () => {
    expect(rowCountOf({ rows: [{}, {}, {}] })).toBe(3);
    expect(rowCountOf({ subjects: [{}] })).toBe(1);
    expect(rowCountOf([{}, {}])).toBe(2);
    expect(rowCountOf({ n: 12, mean: 1 })).toBe(12);
    expect(rowCountOf({ n_observations: 40 })).toBe(40);
    expect(rowCountOf({ codes: [{ n: 2 }, { n: 5 }] })).toBe(7);
    expect(rowCountOf({ baseline: { n: 3 }, target: { n: 4 } })).toBe(7);
    expect(rowCountOf({ window_a: { n: 1 }, window_b: { n: 0 } })).toBe(1);
    expect(rowCountOf(view)).toBe(2);
  });

  test("a refusal reads nothing; an unknown shape is unknown, not zero", () => {
    expect(rowCountOf({ code: "ROW_CAP_EXCEEDED", error: "synthetic" })).toBe(0);
    expect(rowCountOf({ something: true })).toBeNull();
    expect(rowCountOf(undefined)).toBeNull();
  });
});

describe("toolCard", () => {
  test("a refusal is refused with a fixed sentence, never the tool's words", () => {
    const card = toolCard({
      toolCallId: "c1",
      tool: "show_view",
      state: "output-available",
      input: { measure: "8867-4" },
      output: { code: "SUBJECT_REQUIRED", error: "synthetic-tool-wording" },
    });
    expect(card).toEqual({
      id: "c1",
      tool: "show_view",
      title: "Drew a chart",
      args: [{ label: "Measure", value: "8867-4" }],
      state: "refused",
      rowCount: 0,
      note: "A cohort measure needs a subject.",
    });
  });

  test("a timeline card shows its filters, counts records and words NO_ROWS for records", () => {
    const input = {
      subject_ref: "synthetic-subject",
      start: "2019-01-01",
      end: "2021-12-31",
      status: "active",
      code: "59621000",
    };
    const listed = toolCard({
      toolCallId: "t1",
      tool: "conditions_timeline",
      state: "output-available",
      input,
      output: { n: 2, conditions: [] },
    });
    expect(listed).toEqual({
      id: "t1",
      tool: "conditions_timeline",
      title: "Listed recorded conditions",
      args: [
        { label: "Window", value: "1 Jan 2019 – 31 Dec 2021" },
        { label: "Subject", value: "synthetic-subject" },
        { label: "Status", value: "active" },
        { label: "Code", value: "59621000" },
      ],
      state: "done",
      rowCount: 2,
      note: null,
    });
    const none = { code: "NO_ROWS", error: "synthetic-tool-wording" };
    expect(
      toolCard({
        toolCallId: "t2",
        tool: "medications_timeline",
        state: "output-available",
        input,
        output: none,
      }).note,
    ).toBe("No recorded medication request matches in this window.");
    expect(
      toolCard({
        toolCallId: "t3",
        tool: "range_position",
        state: "output-available",
        output: none,
      }).note,
    ).toBe("No reading for that measure in this window.");
  });

  test("a stored audit count wins over the output's", () => {
    expect(
      toolCard(
        { toolCallId: "1", tool: "trend", state: "output-available", output: { n: 3 } },
        9,
      ).rowCount,
    ).toBe(9);
  });

  test("rowsLabel says rows in words", () => {
    expect(rowsLabel(1)).toBe("1 row");
    expect(rowsLabel(1200)).toBe("1,200 rows");
    expect(rowsLabel(null)).toBeNull();
  });
});

describe("toolActivity", () => {
  test("cards keep named arguments and a count; outputs stay behind", () => {
    const parts: ChatUIMessage["parts"] = [
      { type: "step-start" },
      {
        type: "tool-guideline_search",
        toolCallId: "call-1",
        state: "output-available",
        input: { query: "synthetic query" },
        output: [{ passage: "synthetic-passage-text" }],
      },
      { type: "text", text: "Synthetic text.", state: "done" },
      {
        type: "dynamic-tool",
        toolName: "summary_stats",
        toolCallId: "call-2",
        state: "input-available",
        input: { subject_ref: "synthetic-subject-ref", loinc: "8867-4" },
      },
      {
        type: "tool-gbd_population",
        toolCallId: "call-3",
        state: "output-error",
        input: { cause: "Neoplasms" },
        errorText: "synthetic-error-text",
      },
      {
        type: "tool-trend",
        toolCallId: "call-4",
        state: "input-streaming",
        input: undefined,
      },
    ];
    const cards = toolActivity(parts);
    expect(cards).toEqual([
      {
        id: "call-1",
        tool: "guideline_search",
        title: "Searched guidelines",
        args: [{ label: "Search", value: "synthetic query" }],
        state: "done",
        rowCount: 1,
        note: null,
      },
      {
        id: "call-2",
        tool: "summary_stats",
        title: "Summarised a measure",
        args: [
          { label: "Measure", value: "8867-4" },
          { label: "Subject", value: "synthetic-subject-ref" },
        ],
        state: "running",
        rowCount: null,
        note: null,
      },
      {
        id: "call-3",
        tool: "gbd_population",
        title: "Looked up population data",
        args: [{ label: "Cause", value: "Neoplasms" }],
        state: "error",
        rowCount: null,
        note: null,
      },
      {
        id: "call-4",
        tool: "trend",
        title: "Fitted a trend",
        args: [],
        state: "running",
        rowCount: null,
        note: null,
      },
    ]);
    expect(JSON.stringify(cards)).not.toContain("synthetic-passage-text");
    expect(JSON.stringify(cards)).not.toContain("synthetic-error-text");
  });
});

describe("a reload rebuilds the cards the stream showed", () => {
  const input = {
    kind: "chart.timeseries",
    measure: "sleep.score",
    window: { start: "2026-10-01", end: "2026-10-03" },
  };
  const stored = [
    {
      seq: 1,
      tool: "show_view",
      input,
      output: view,
      argsSha256: "a".repeat(64),
      resultSha256: "b".repeat(64),
      rowCount: null,
      at: "2026-10-15T09:00:00.000Z",
    },
    {
      seq: 2,
      tool: "observations_for_subject",
      input: { subject_ref: "synthetic-subject-1", loinc: ["8867-4"] },
      output: { rows: [{}, {}, {}] },
      argsSha256: "c".repeat(64),
      resultSha256: "d".repeat(64),
      rowCount: 3,
      at: "2026-10-15T09:00:00.000Z",
    },
  ];

  test("same titles, arguments, states and counts; ids from seq", () => {
    const live = toolActivity(
      stored.map((part) => ({
        type: `tool-${part.tool}` as const,
        toolCallId: `live-${part.seq}`,
        state: "output-available" as const,
        input: part.input,
        output: part.output,
      })) as ChatUIMessage["parts"],
    );
    const saved = toSavedResponseState({
      id: "response-1",
      modelId: "synthetic/model",
      modelName: "Synthetic",
      position: 0,
      status: "COMPLETE",
      text: "## Answer\nSynthetic.",
      reasoningText: null,
      attribution: null,
      responseDocument: null,
      toolParts: stored,
      timeToFirstTokenMs: null,
      tokensPerSecond: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: 0,
    }).tools;
    expect(saved).toEqual(
      live.map((card, index) => ({ ...card, id: String(index + 1) })),
    );
    expect(saved?.map((card) => card.rowCount)).toEqual([2, 3]);
  });
});

describe("view tool cards", () => {
  test("list_views counts the charts it listed", () => {
    expect(
      toolCard({
        toolCallId: "c1",
        tool: "list_views",
        state: "output-available",
        input: {},
        output: { views: [{ id: "view-1" }, { id: "view-2" }] },
      }),
    ).toEqual({
      id: "c1",
      tool: "list_views",
      title: "Listed this thread's charts",
      args: [],
      state: "done",
      rowCount: 2,
      note: null,
    });
  });

  test("open_view names the chart; refusals read as fixed sentences", () => {
    const refused = (code: string) =>
      toolCard({
        toolCallId: "c2",
        tool: "open_view",
        state: "output-available",
        input: { id: "view-9" },
        output: { code, error: "synthetic-tool-wording" },
      });
    expect(refused("VIEW_NOT_FOUND")).toEqual({
      id: "c2",
      tool: "open_view",
      title: "Reopened a chart",
      args: [{ label: "Chart", value: "view-9" }],
      state: "refused",
      rowCount: 0,
      note: "No chart with that id in this thread.",
    });
    expect(refused("UNKNOWN_MEASURE").note).toBe(
      "That measure is not a LOINC code or a known wearable key.",
    );
  });
});

import { describe, expect, test } from "bun:test";

import { type ChatView, timeseriesView, twinBodyView } from "./chat-view";
import {
  buildUiContext,
  type UiContext,
  UI_CONTEXT_AUDIT_TOOL,
  UI_CONTEXT_MAX_CHARS,
  UI_CONTEXT_MAX_VIEWS,
  uiContextBlock,
  uiContextEvent,
  uiContextLines,
  uiContextSchema,
  type UiState,
} from "./ui-context";

const series = (measure: string, seq: string): ChatView =>
  timeseriesView({
    spec: {
      measure,
      label: "HbA1c",
      unit: "%",
      window: { start: "2026-01-01", end: "2026-03-31T23:59:59Z" },
      subject: "synthetic-subject",
      points: [{ at: "2026-02-01T00:00:00.000Z", value: 6.1 }],
    },
    sourceAuditIds: [seq],
  });

const liver: ChatView = twinBodyView({
  spec: {
    focus: "liver",
    label: "Liver",
    body: "demo",
    subject: null,
    window: { start: "2026-01-01", end: "2026-03-31" },
    unit: null,
    organs: [],
    n: 0,
  },
  sourceAuditIds: ["9"],
});

const NOTHING: UiState = {
  outputsOpen: false,
  twinOpen: false,
  organ: null,
  largeView: null,
  views: [],
};

/** The longest context the schema allows: every part set, every field at its cap. */
const LONGEST: UiContext = {
  panels: ["outputs", "twin"],
  organ: "bloodvasculature",
  chart: {
    kind: "chart.timeseries",
    measure: "a".repeat(40),
    start: "2026-01-01",
    end: "2026-03-31",
  },
  views: Array.from({ length: UI_CONTEXT_MAX_VIEWS }, (_, index) => ({
    kind: "chart.timeseries" as const,
    measure: `${index}${"b".repeat(39)}`,
  })),
  viewCount: 9999,
};

describe("buildUiContext", () => {
  test("nothing on screen is no context", () => {
    expect(buildUiContext(NOTHING)).toBeNull();
  });

  test("panels, organ, the large chart and the thread's views", () => {
    const views = [series("4548-4", "3"), liver, series("2093-3", "1")];
    expect(
      buildUiContext({
        outputsOpen: true,
        twinOpen: true,
        organ: "liver",
        largeView: views[0] ?? null,
        views,
      }),
    ).toEqual({
      panels: ["outputs", "twin"],
      organ: "liver",
      chart: {
        kind: "chart.timeseries",
        measure: "4548-4",
        start: "2026-01-01",
        end: "2026-03-31",
      },
      views: [
        { kind: "chart.timeseries", measure: "4548-4" },
        { kind: "twin.body", measure: "liver" },
        { kind: "chart.timeseries", measure: "2093-3" },
      ],
      viewCount: 3,
    });
  });

  test("a twin view with no window names no chart days", () => {
    const latest = twinBodyView({
      spec: {
        focus: "liver",
        label: "Liver",
        body: "demo",
        subject: "synthetic-1",
        window: null,
        unit: null,
        organs: [],
        n: 0,
      },
      sourceAuditIds: ["10"],
    });
    expect(buildUiContext({ ...NOTHING, largeView: latest, views: [latest] })).toEqual({
      panels: [],
      organ: null,
      chart: null,
      views: [{ kind: "twin.body", measure: "liver" }],
      viewCount: 1,
    });
  });

  test("lists at most four views, once each, and counts them all", () => {
    const views = ["1", "2", "3", "4", "5"].map((seq) => series(`1000${seq}-1`, seq));
    const context = buildUiContext({ ...NOTHING, views: [...views, views[0]!] });
    expect(context?.views.map((view) => view.measure)).toEqual([
      "10001-1",
      "10002-1",
      "10003-1",
      "10004-1",
    ]);
    expect(context?.viewCount).toBe(6);
  });

  test("a measure that is not a plain code is counted, not listed", () => {
    const context = buildUiContext({ ...NOTHING, views: [series("heart rate 72", "1")] });
    expect(context).toEqual({
      panels: [],
      organ: null,
      chart: null,
      views: [],
      viewCount: 1,
    });
  });
});

describe("uiContextBlock", () => {
  test("a heading and one line per part that is set", () => {
    expect(
      uiContextBlock({
        panels: ["outputs"],
        organ: "liver",
        chart: null,
        views: [{ kind: "biomarker.card", measure: "2324-2" }],
        viewCount: 2,
      }),
    ).toBe(
      [
        "## UI context",
        'What the person has on screen as they ask; no values. Read "this" or "it" against it.',
        "- open: outputs",
        "- organ: liver",
        "- views in this thread (2, newest first): biomarker.card 2324-2",
      ].join("\n"),
    );
  });

  test("empty when no line is set", () => {
    expect(
      uiContextBlock({ panels: [], organ: null, chart: null, views: [], viewCount: 0 }),
    ).toBe("");
  });

  test("the longest context the schema allows stays under the cap", () => {
    expect(uiContextBlock(LONGEST).length).toBe(520);
    expect(uiContextBlock(LONGEST).length).toBeLessThanOrEqual(UI_CONTEXT_MAX_CHARS);
    expect(uiContextSchema.safeParse(LONGEST).success).toBe(true);
  });
});

describe("uiContextSchema", () => {
  test("refuses a value smuggled in as a measure", () => {
    expect(
      uiContextSchema.safeParse({
        ...LONGEST,
        views: [{ kind: "table", measure: "glucose 7.8 mmol/L" }],
      }).success,
    ).toBe(false);
  });

  test("refuses unknown fields, organs and too many views", () => {
    expect(uiContextSchema.safeParse({ ...LONGEST, note: "x" }).success).toBe(false);
    expect(uiContextSchema.safeParse({ ...LONGEST, organ: "spleen" }).success).toBe(
      false,
    );
    expect(
      uiContextSchema.safeParse({
        ...LONGEST,
        views: [...LONGEST.views, { kind: "table", measure: "x" }],
      }).success,
    ).toBe(false);
  });

  test("refuses a chart range that is not two calendar days", () => {
    expect(
      uiContextSchema.safeParse({
        ...LONGEST,
        chart: { ...LONGEST.chart, start: "2026-01-01T00:00:00Z" },
      }).success,
    ).toBe(false);
  });

  test("refuses fewer counted views than listed", () => {
    expect(uiContextSchema.safeParse({ ...LONGEST, viewCount: 1 }).success).toBe(false);
  });
});

describe("uiContextEvent", () => {
  test("the context is the row's arguments; it reads no rows", () => {
    const context: UiContext = {
      panels: ["twin"],
      organ: "heart",
      chart: null,
      views: [],
      viewCount: 0,
    };
    expect(
      uiContextEvent(context, { actor: "user_1", sessionId: "turn-1", modelId: "m" }),
    ).toEqual({
      actor: "user_1",
      sessionId: "turn-1",
      subjectRef: null,
      tool: UI_CONTEXT_AUDIT_TOOL,
      args: { modelId: "m", context },
      result: { lines: 2 },
      rowCount: 0,
    });
    expect(uiContextLines(context)).toEqual(["- open: twin", "- organ: heart"]);
  });
});

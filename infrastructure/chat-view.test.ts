import { describe, expect, test } from "bun:test";

import {
  type ChatView,
  compareView,
  timeseriesView,
  toChatView,
  twinBodyTitle,
  viewReadings,
  viewsOf,
  viewTitle,
} from "./chat-view";

const spec = {
  measure: "8867-4",
  label: "Heart rate",
  unit: "/min",
  window: { start: "2026-10-01", end: "2026-10-31" },
  subject: "synthetic-subject-1",
  points: [
    { at: "2026-10-02T08:00:00.000Z", value: 61 },
    { at: "2026-10-09T08:00:00.000Z", value: 64 },
  ],
};

const view: ChatView = timeseriesView({ spec, sourceAuditIds: ["41"] });

describe("timeseriesView", () => {
  test("builds the view from the spec and names it after its audit rows", () => {
    expect(view).toEqual({
      id: "view-41",
      kind: "chart.timeseries",
      title: "Heart rate, 1 Oct 2026 – 31 Oct 2026",
      spec,
      sourceAuditIds: ["41"],
    });
  });

  test("titles use plain dates, never a raw timestamp", () => {
    expect(
      viewTitle("Heart rate", {
        start: "2016-01-01T00:00:00.000Z",
        end: "2026-10-31T23:59:59.999Z",
      }),
    ).toBe("Heart rate, 1 Jan 2016 – 31 Oct 2026");
    expect(viewTitle("Steps", { start: "2026-10-01T08:00Z", end: "2026-10-02" })).toBe(
      "Steps, 1 Oct 2026 – 2 Oct 2026",
    );
  });
});

describe("toChatView", () => {
  test("keeps a whole view and rejects one without an audit source or with a bad point", () => {
    expect(toChatView(view)).toEqual(view);
    expect(toChatView({ ...view, sourceAuditIds: [] })).toBeNull();
    expect(
      toChatView({ ...view, spec: { ...spec, points: [{ at: "x", value: "61" }] } }),
    ).toBeNull();
    expect(toChatView({ code: "SUBJECT_SCOPE_VIOLATION" })).toBeNull();
  });
});

describe("viewsOf", () => {
  test("reads data-view parts and stored show_view outputs, once per id", () => {
    const other = timeseriesView({
      spec: { ...spec, points: [] },
      sourceAuditIds: ["42"],
    });
    expect(
      viewsOf([
        { type: "tool-show_view", state: "output-available", output: view },
        { type: "data-view", data: view },
        { type: "tool-show_view", state: "input-available" },
        { type: "tool-show_view", state: "output-available", output: { code: "X" } },
        { type: "tool-trend", state: "output-available", output: view },
        { type: "data-view", data: other },
      ]),
    ).toEqual([view, other]);
  });
});

describe("the other kinds", () => {
  const compare = compareView({
    spec: {
      measure: "93832-4",
      label: "Sleep duration",
      unit: "h",
      subject: null,
      layout: "overlaid",
      before: { start: "2026-09-01", end: "2026-09-27", n: 1, mean: 7, points: [] },
      after: { start: "2026-09-28", end: "2026-10-04", n: 2, mean: 6.5, points: [] },
      meanDelta: -0.5,
    },
    sourceAuditIds: ["7", "8"],
  });

  test("a compare view is titled by both windows and counts both", () => {
    expect(compare.id).toBe("view-7-8");
    expect(compare.title).toBe(
      "Sleep duration, 28 Sept 2026 – 4 Oct 2026 vs 1 Sept 2026 – 27 Sept 2026",
    );
    expect(viewReadings(compare)).toBe(3);
    expect(viewReadings(view)).toBe(2);
    expect(toChatView(compare)).toEqual(compare);
  });

  test("a spec that does not parse is no view", () => {
    expect(
      toChatView({ ...compare, spec: { ...compare.spec, layout: "stacked" } }),
    ).toBeNull();
    const before = {
      start: "2026-09-01",
      end: "2026-09-27",
      n: 1,
      mean: "7",
      points: [],
    };
    expect(toChatView({ ...compare, spec: { ...compare.spec, before } })).toBeNull();
    expect(toChatView({ ...compare, kind: "twin.body" })).toBeNull();
  });
});

describe("twinBodyTitle", () => {
  const spec = {
    focus: "liver",
    label: "Liver",
    body: "demo",
    subject: "synthetic-1",
    window: { start: "2026-01-01", end: "2026-03-31" },
    unit: null,
    organs: [],
    n: 0,
  } as const;

  test("a window is named, as for every view", () => {
    expect(twinBodyTitle(spec)).toBe("Body twin: Liver, 1 Jan 2026 – 31 Mar 2026");
  });

  test("no window: latest readings with a subject, the label alone without", () => {
    expect(twinBodyTitle({ ...spec, window: null })).toBe(
      "Body twin: Liver, latest readings",
    );
    expect(twinBodyTitle({ ...spec, window: null, subject: null })).toBe(
      "Body twin: Liver",
    );
  });
});

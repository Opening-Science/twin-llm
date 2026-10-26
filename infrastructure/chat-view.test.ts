import { describe, expect, test } from "bun:test";

import {
  type ChatView,
  timeseriesView,
  toChatView,
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

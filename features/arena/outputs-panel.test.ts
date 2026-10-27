import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { timeseriesView } from "@/infrastructure/chat-view";

import { OutputsPanel } from "./outputs-panel";
import { isEmptyView, type OutputEntry } from "./thread-outputs";

const view = (seq: string, label: string, points: readonly number[]) =>
  timeseriesView({
    spec: {
      measure: "sleep.score",
      label,
      unit: null,
      window: { start: "2026-10-01", end: "2026-10-03" },
      subject: null,
      points: points.map((value) => ({ at: "2026-10-01T00:00:00.000Z", value })),
    },
    sourceAuditIds: [seq],
  });

const entry = (key: string, chart: ReturnType<typeof view>): OutputEntry => ({
  key,
  anchorId: `output-${key}`,
  view: chart,
  modelName: "Model A",
  at: null,
});

describe("Outputs panel rows", () => {
  const full = entry("a", view("1", "Sleep score", [77]));
  const empty = entry("b", view("2", "Steps", []));

  test("a view with no points is marked empty", () => {
    expect([isEmptyView(full.view), isEmptyView(empty.view)]).toEqual([false, true]);
  });

  test("an empty view is listed dimmed with 'No readings'; a drawn one is not", () => {
    const markup = renderToStaticMarkup(
      createElement(OutputsPanel, { entries: [full, empty] }),
    );
    const rows = markup.split('<li class="output-entry"').slice(1);
    expect(rows.length).toBe(2);
    expect(rows[0]).not.toContain("data-empty");
    expect(rows[0]).not.toContain("No readings");
    expect(rows[0]).toContain('class="line-clamp-2 text-foreground font-medium"');
    expect(rows[1]).toContain('data-empty="true"');
    expect(rows[1]).toContain("No readings · ");
    expect(rows[1]).toContain('class="line-clamp-2 text-muted-foreground"');
  });

  test("no entries, no panel", () => {
    expect(renderToStaticMarkup(createElement(OutputsPanel, { entries: [] }))).toBe("");
  });
});

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PERIOD_LOADING, PERIOD_MOCK } from "./day-copy";
import { PeriodCard } from "./period-card";
import { type PeriodState } from "./use-my-day";

const noop = () => undefined;

const STATE: PeriodState = {
  period: "week",
  available: true,
  summary: {
    period: "week",
    start: "2026-11-10",
    end: "2026-11-16",
    title: "Week, 10 Nov 2026 to 16 Nov 2026",
    lines: [
      { label: "Blood glucose", text: "Average 103 mg/dL from 31 readings on 7 days." },
      {
        label: "Recovery after workouts",
        text: "Not recorded: no workout times are stored.",
      },
    ],
    notes: ["Times are UTC."],
  },
  error: null,
  onPeriod: noop,
};

const html = (state: PeriodState) =>
  renderToStaticMarkup(createElement(PeriodCard, { state })).replace(/&#x27;/g, "'");

describe("PeriodCard", () => {
  test("draws the title, every line and note as given", () => {
    const out = html(STATE);
    expect(out).toContain("Week, 10 Nov 2026 to 16 Nov 2026");
    expect(out).toContain("<dt");
    expect(out).toContain("Average 103 mg/dL from 31 readings on 7 days.");
    expect(out).toContain("Times are UTC.");
  });

  test("the mock day gets a sentence and no period switch", () => {
    const out = html({ ...STATE, available: false });
    expect(out).toContain(PERIOD_MOCK);
    expect(out).not.toContain("Average");
    expect(out).not.toContain('role="group"');
  });

  test("an error is the route's sentence; nothing loaded yet says so", () => {
    expect(
      html({ ...STATE, summary: undefined, error: "Could not load this day." }),
    ).toContain("Could not load this day.");
    expect(html({ ...STATE, summary: undefined })).toContain(PERIOD_LOADING);
  });
});

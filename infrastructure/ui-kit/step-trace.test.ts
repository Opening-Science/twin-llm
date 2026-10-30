import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { StepTrace, type StepTraceProps } from "./step-trace";

const steps: StepTraceProps["steps"] = [
  {
    id: "a",
    label: "Reading resting heart rate, 4 Jul 2026 – 1 Oct 2026",
    state: "done",
  },
  { id: "b", label: "No data: NO_ROWS", state: "skipped" },
  { id: "c", label: "Fitting an HRV trend", state: "current" },
];

const render = (props: StepTraceProps) =>
  renderToStaticMarkup(createElement(StepTrace, props));

describe("StepTrace", () => {
  test("working: names the current step, runs a timer and shows the list", () => {
    const html = render({ steps, state: "working" });
    expect(html).toContain('<p role="status" class="sr-only">Working.</p>');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain(
      'class="min-w-0 flex-1 truncate step-trace-working">Fitting an HRV trend</span>',
    );
    expect(html).toContain(
      '<span class="step-trace-timer" aria-hidden="true">0.0s</span>',
    );
    expect(html).not.toMatch(/<ol[^>]*hidden/);
  });

  test("each step says its state in words before its label", () => {
    const html = render({ steps, state: "working" });
    expect(html).toContain('<span class="sr-only">Done: </span>');
    expect(html).toContain('<span class="sr-only">No data: </span>');
    expect(html).toContain('<span class="sr-only">In progress: </span>');
    expect(html).toContain('<div class="min-w-0 flex-1">No data: NO_ROWS</div>');
  });

  test("working between steps: the caller's words breathe on the line", () => {
    const html = render({
      steps: steps.slice(0, 2),
      state: "working",
      workingLabel: "Preparing the answer…",
    });
    expect(html).toContain('step-trace-waiting">Preparing the answer…</span>');
  });

  test("settled on load: folded, counted, no timer and no invented time", () => {
    const html = render({ steps, state: "done" });
    expect(html).toContain('<p role="status" class="sr-only">Done. Used 3 tools.</p>');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('<span class="min-w-0 flex-1 truncate">Used 3 tools</span>');
    expect(html).not.toContain("step-trace-timer");
    const listId = /aria-controls="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<ol id="${listId}" hidden="" aria-label="Steps"`);
  });

  test("a step's detail replaces its plain label", () => {
    const html = render({
      steps: [
        {
          id: "a",
          label: "Plain",
          state: "done",
          detail: createElement("em", null, "Rich"),
        },
      ],
      state: "failed",
      listLabel: "Tool calls",
    });
    expect(html).toContain('aria-label="Tool calls"');
    expect(html).toContain("<em>Rich</em>");
    expect(html).not.toContain("Plain");
    expect(html).toContain("Stopped after 1 tool");
  });
});

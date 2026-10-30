import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { StatusLattice } from "./status-lattice";

describe("StatusLattice", () => {
  test("working: nine dots on a wave, the state in words, a live region without the timer", () => {
    const html = renderToStaticMarkup(
      createElement(StatusLattice, { state: "working", label: "Benchmark" }),
    );
    expect(html.match(/class="status-lattice-dot" data-on=""/g)?.length).toBe(9);
    expect(html).toContain('style="animation-delay:440ms"');
    expect(html).toContain(
      '<span role="status" class="sr-only">Benchmark: Working</span>',
    );
  });

  test("done with a caller's time: a tick of four dots and the frozen time", () => {
    const html = renderToStaticMarkup(
      createElement(StatusLattice, {
        state: "done",
        label: "Synthea run",
        elapsedMs: 83_400,
      }),
    );
    expect(html.match(/data-on=""/g)?.length).toBe(4);
    expect(html).toContain(
      '<span class="status-lattice-timer" aria-hidden="true">1m 23s</span>',
    );
    expect(html).toContain("Synthea run: Done");
  });

  test("error draws a cross; with no time known, no timer", () => {
    const html = renderToStaticMarkup(
      createElement(StatusLattice, { state: "error", label: "Evaluation" }),
    );
    expect(html.match(/data-on=""/g)?.length).toBe(5);
    expect(html).not.toContain("status-lattice-timer");
    expect(html).toContain("Evaluation: Failed");
  });
});

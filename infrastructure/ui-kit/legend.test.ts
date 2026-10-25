import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Legend } from "./legend";

describe("Legend", () => {
  test("colours the swatch only and hides it from assistive tech", () => {
    const html = renderToStaticMarkup(
      createElement(Legend, {
        items: [
          { id: "a", label: "Sleep score", swatchClassName: "text-chart-1" },
          { id: "b", label: "Readiness", swatchClassName: "text-chart-2" },
        ],
      }),
    );
    expect(html).toBe(
      '<ul class="flex flex-wrap gap-4">' +
        '<li class="text-foreground flex items-center gap-1.5 text-xs"><span class="size-2 rounded-full bg-current text-chart-1" aria-hidden="true"></span>Sleep score</li>' +
        '<li class="text-foreground flex items-center gap-1.5 text-xs"><span class="size-2 rounded-full bg-current text-chart-2" aria-hidden="true"></span>Readiness</li>' +
        "</ul>",
    );
  });

  test("a fixed swatchColor is set inline and ringed, the label stays foreground", () => {
    const html = renderToStaticMarkup(
      createElement(Legend, {
        items: [{ id: "auto", label: "Markers · Auto", swatchColor: "#8ec5ff" }],
        className: "mt-2",
      }),
    );
    expect(html).toBe(
      '<ul class="flex flex-wrap gap-4 mt-2">' +
        '<li class="text-foreground flex items-center gap-1.5 text-xs"><span class="size-2 rounded-full bg-current ring-border ring-1" style="color:#8ec5ff" aria-hidden="true"></span>Markers · Auto</li>' +
        "</ul>",
    );
  });
});

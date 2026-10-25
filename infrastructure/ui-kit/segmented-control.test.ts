import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SegmentedControl } from "./segmented-control";

const options = [
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
] as const;

const render = (value: "7" | "14" | "30" | null, size?: "sm" | "md") =>
  renderToStaticMarkup(
    createElement(SegmentedControl<"7" | "14" | "30">, {
      label: "Preset ranges",
      options,
      value,
      onChange: () => undefined,
      size,
    }),
  );

describe("SegmentedControl", () => {
  test("is a labelled group of buttons with exactly one pressed", () => {
    const html = render("14");
    expect(html).toContain('role="group" aria-label="Preset ranges"');
    expect(html.match(/<button type="button"/g)?.length).toBe(3);
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(2);
    expect(html).toContain('aria-pressed="true" class="segmented-item">14 days');
  });

  test("presses nothing when the value matches no option", () => {
    const html = render(null);
    expect(html).not.toContain('aria-pressed="true"');
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(3);
  });

  test("the small size adds the compact item class", () => {
    expect(render("7", "sm")).toContain(
      'class="segmented-item segmented-item-sm">7 days',
    );
  });
});

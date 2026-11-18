import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Switch, SWITCH_HIT_AREA } from "./switch";

const render = (checked: boolean) =>
  renderToStaticMarkup(
    createElement(Switch, { checked, onChange: () => {}, label: "Twin notes" }),
  );

describe("Switch", () => {
  test("is a named switch button that says whether it is on", () => {
    const html = render(true);
    expect(html).toContain('type="button"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="Twin notes"');
    expect(render(false)).toContain('aria-checked="false"');
  });

  test("reaches past the 20px track so a finger has at least 24px to hit", () => {
    expect(SWITCH_HIT_AREA).toContain("before:absolute");
    // 6px out from inside the 1px border, above and below the 20px track: 30px high.
    expect(SWITCH_HIT_AREA).toContain("before:-inset-y-1.5");
    expect(render(false)).toContain(SWITCH_HIT_AREA.replaceAll("'", "&#x27;"));
  });
});

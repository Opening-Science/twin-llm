import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HoldToSubmit } from "./hold-to-submit";

describe("HoldToSubmit", () => {
  test("idle inside a form: a hold button that is not a submit button", () => {
    const html = renderToStaticMarkup(
      createElement(
        "form",
        null,
        createElement(HoldToSubmit, {
          label: "Hold to withdraw consent",
          pendingLabel: "Withdrawing…",
          pending: false,
        }),
      ),
    );
    expect(html).toContain('<span class="contents"><button type="button"');
    expect(html).not.toContain('type="submit"');
    expect(html).toContain('data-phase="idle"');
    expect(html).toContain(
      '<span class="hold-confirm-label">Hold to withdraw consent</span>',
    );
  });

  test("pending: the button is disabled", () => {
    const html = renderToStaticMarkup(
      createElement(HoldToSubmit, {
        label: "Hold to withdraw consent",
        pendingLabel: "Withdrawing…",
        pending: true,
      }),
    );
    expect(html).toContain('<button type="button" disabled=""');
  });
});

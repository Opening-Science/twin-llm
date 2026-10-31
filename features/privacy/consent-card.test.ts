import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ConsentCard } from "./consent-card";
import type { ScopeView } from "./privacy-view";

const VIEW: ScopeView = {
  scope: "training",
  name: "Training",
  purpose: "Synthetic purpose",
  active: {
    id: "consent-synthetic-1",
    since: "1 Oct 2026",
    sources: "Wearables",
    wording: "A synthetic sentence.",
  },
  past: [],
};

describe("ConsentCard", () => {
  test("an active consent is withdrawn by a hold, not a submit button", () => {
    const html = renderToStaticMarkup(
      createElement(ConsentCard, { view: VIEW, choices: [] }),
    );
    expect(html).not.toContain('type="submit"');
    expect(html).toContain(
      '<span class="hold-confirm-label">Hold to withdraw consent</span>',
    );
  });

  test("an inactive use is granted with a plain submit button", () => {
    const html = renderToStaticMarkup(
      createElement(ConsentCard, { view: { ...VIEW, active: null }, choices: [] }),
    );
    expect(html).toContain('type="submit"');
    expect(html).not.toContain("hold-confirm");
  });
});

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Rating } from "./rating";

describe("Rating", () => {
  test("a radio group: each star named, the chosen one checked and in the Tab order", () => {
    const html = renderToStaticMarkup(
      createElement(Rating, { label: "Accuracy", value: 3, onChange: () => undefined }),
    );
    expect(html).toContain('role="radiogroup" aria-label="Accuracy"');
    expect(html).toContain(
      'role="radio" aria-checked="true" aria-label="3 of 5: Good" tabindex="0" data-on=""',
    );
    expect(html).toContain(
      'role="radio" aria-checked="false" aria-label="4 of 5: Very good" tabindex="-1"',
    );
    expect(html.match(/tabindex="0"/g)?.length).toBe(1);
    expect(html).toContain(
      '<span class="rating-text" aria-hidden="true">3 of 5: Good</span>',
    );
  });

  test("not rated: the first star takes the Tab stop", () => {
    const html = renderToStaticMarkup(
      createElement(Rating, { label: "Clarity", value: null, labels: ["No", "Yes"] }),
    );
    expect(html).toContain('aria-label="1 of 2: No" tabindex="0"');
    expect(html).toContain(">Not rated<");
    expect(html).not.toContain("data-on");
  });

  test("read only says so to assistive technology", () => {
    const html = renderToStaticMarkup(
      createElement(Rating, { label: "Accuracy", value: 5, readOnly: true }),
    );
    expect(html).toContain('aria-readonly="true"');
    expect(html).toContain('class="rating" data-readonly=""');
  });
});

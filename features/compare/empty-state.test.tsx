import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EMPTY_LINE, EmptyState } from "./empty-state";

describe("EmptyState", () => {
  test("names the page with its one h1, as a thread names it with its own", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { incognito: false, showToggle: false }),
    );
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(`<h1 class="text-display">TwinLLM</h1>`);
    expect(html).not.toContain("<h2");
    expect(html).toContain(EMPTY_LINE);
  });
});

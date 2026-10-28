import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CollapsiblePanel } from "./collapsible-panel";

const render = (open: boolean, className?: string) =>
  renderToStaticMarkup(
    createElement(
      CollapsiblePanel,
      { label: "Anatomy", open, onToggle: () => undefined, className },
      createElement("p", null, "inside"),
    ),
  );

describe("CollapsiblePanel", () => {
  test("open: the button says expanded and the body shows", () => {
    const html = render(true, "twin-panel");
    const id = /aria-controls="([^"]+)"/.exec(html)?.[1];
    expect(html).toBe(
      `<div class="collapsible-panel twin-panel" data-open="">` +
        `<button type="button" aria-expanded="true" aria-controls="${id}" class="collapsible-panel-toggle">` +
        `<span>Anatomy</span><span aria-hidden="true">−</span></button>` +
        `<div id="${id}" class="collapsible-panel-body"><p>inside</p></div></div>`,
    );
  });

  test("closed: the body stays mounted but hidden", () => {
    const html = render(false);
    const id = /aria-controls="([^"]+)"/.exec(html)?.[1];
    expect(html).toBe(
      `<div class="collapsible-panel">` +
        `<button type="button" aria-expanded="false" aria-controls="${id}" class="collapsible-panel-toggle">` +
        `<span>Anatomy</span><span aria-hidden="true">+</span></button>` +
        `<div id="${id}" hidden="" class="collapsible-panel-body"><p>inside</p></div></div>`,
    );
  });
});

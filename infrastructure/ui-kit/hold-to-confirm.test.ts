import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HoldToConfirm } from "./hold-to-confirm";

describe("HoldToConfirm", () => {
  test("idle: the label, an empty fill and a hint that states the hold time", () => {
    const html = renderToStaticMarkup(
      createElement(HoldToConfirm, {
        label: "Erase my data",
        holdMs: 2000,
        onConfirm: () => undefined,
      }),
    );
    const hint = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain('data-phase="idle"');
    expect(html).toContain('<span aria-hidden="true" class="hold-confirm-fill"></span>');
    expect(html).toContain('<span class="hold-confirm-label">Erase my data</span>');
    expect(html).toContain(
      `<span id="${hint}" class="sr-only">Press and hold for 2 seconds to confirm. With a keyboard, hold Space or Enter.</span>`,
    );
  });
});

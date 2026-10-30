import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { UndoButton } from "./undo-button";

describe("UndoButton", () => {
  test("idle: the label and icon, a hidden line and a quiet live region", () => {
    const html = renderToStaticMarkup(
      createElement(UndoButton, {
        label: "Delete thread",
        icon: createElement("i", null),
        actedText: "Thread deleted.",
        onAct: () => undefined,
        onUndo: () => undefined,
        onExpire: () => undefined,
      }),
    );
    expect(html).toContain("<i></i>Delete thread");
    expect(html).toContain('hidden="" aria-hidden="true" class="undo-button-line"');
    expect(html).toContain('<span role="status" class="sr-only"></span>');
    expect(html).not.toContain("data-armed");
  });
});

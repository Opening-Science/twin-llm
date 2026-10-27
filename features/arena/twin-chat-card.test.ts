import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TwinChatCard } from "./twin-chat-card";

const noop = () => undefined;

const render = (collapsed: boolean) =>
  renderToStaticMarkup(
    createElement(
      TwinChatCard,
      {
        label: "Digital twin · Synthetic person 3",
        collapsed,
        onCollapse: noop,
        onExpand: noop,
        onClose: noop,
      },
      createElement("p", { id: "viewer-stub" }, "viewer"),
    ),
  );

/** Every `<button …>` opening tag, in order. */
const buttons = (markup: string): readonly string[] =>
  markup.match(/<button[^>]*>/g) ?? [];

const attr = (tag: string, name: string): string | null =>
  new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

describe("TwinChatCard", () => {
  test("open: the label, a collapse button that controls the body, and close", () => {
    const markup = render(false);
    expect(markup).toContain('aria-label="Digital twin in this chat"');
    expect(markup).toContain(">Digital twin · Synthetic person 3</p>");
    expect(markup).toContain(">Shown in the chat only; no model sees it.</p>");
    expect(markup).toContain('<p id="viewer-stub">viewer</p>');
    const [collapse, close] = buttons(markup);
    expect(buttons(markup).length).toBe(2);
    expect(attr(collapse ?? "", "type")).toBe("button");
    expect(attr(collapse ?? "", "aria-label")).toBe("Collapse the digital twin");
    expect(attr(collapse ?? "", "aria-expanded")).toBe("true");
    const bodyId = attr(collapse ?? "", "aria-controls");
    expect(markup).toContain(`<div id="${bodyId}" class="twin-chat-body">`);
    expect(attr(close ?? "", "type")).toBe("button");
    expect(attr(close ?? "", "aria-label")).toBe("Close the digital twin");
  });

  test("collapsed: a one-line chip that reopens it, a close button, and no viewer", () => {
    const markup = render(true);
    expect(markup).toContain('class="twin-chat-chip"');
    expect(markup).not.toContain("viewer-stub");
    const [reopen, close] = buttons(markup);
    expect(buttons(markup).length).toBe(2);
    expect(attr(reopen ?? "", "aria-expanded")).toBe("false");
    expect(attr(reopen ?? "", "aria-label")).toBe(
      "Open the digital twin: Digital twin · Synthetic person 3",
    );
    expect(markup).toContain(
      '<span class="truncate">Digital twin · Synthetic person 3</span>',
    );
    expect(attr(close ?? "", "aria-label")).toBe("Close the digital twin");
  });
});

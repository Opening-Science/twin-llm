import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CommandPalette, commandOptionId, paletteKey } from "./command-palette";
import { type Command } from "./registry";

const commands: readonly Command[] = [
  { name: "connect", description: "Connect a wearable", reads: [] },
  { name: "sleep", description: "Sleep summary", reads: ["oura", "whoop"] },
];

const render = (activeIndex: number, list: readonly Command[] = commands) =>
  renderToStaticMarkup(
    createElement(CommandPalette, { commands: list, activeIndex, onPick: () => {} }),
  );

describe("paletteKey", () => {
  test("arrows move through the list and wrap at both ends", () => {
    expect(paletteKey("ArrowDown", 0, 2)).toEqual({ kind: "move", index: 1 });
    expect(paletteKey("ArrowDown", 1, 2)).toEqual({ kind: "move", index: 0 });
    expect(paletteKey("ArrowUp", 0, 2)).toEqual({ kind: "move", index: 1 });
    expect(paletteKey("ArrowUp", 1, 2)).toEqual({ kind: "move", index: 0 });
  });

  test("enter picks, escape closes, other keys do nothing", () => {
    expect(paletteKey("Enter", 0, 2)).toBe("pick");
    expect(paletteKey("Escape", 0, 2)).toBe("close");
    expect(paletteKey("a", 0, 2)).toBeNull();
    expect(paletteKey("Tab", 0, 2)).toBeNull();
  });

  test("arrows do nothing on an empty list", () => {
    expect(paletteKey("ArrowDown", 0, 0)).toBeNull();
    expect(paletteKey("ArrowUp", 0, 0)).toBeNull();
  });
});

describe("CommandPalette", () => {
  test("options are a listbox and only the active one is selected", () => {
    const html = render(1);
    expect(html).toContain('<ul role="listbox" aria-label="Commands"');
    expect(html).toContain(
      '<button type="button" role="option" id="command-option-connect" aria-selected="false"',
    );
    expect(html).toContain(
      '<button type="button" role="option" id="command-option-sleep" aria-selected="true"',
    );
    expect(commandOptionId("sleep")).toBe("command-option-sleep");
  });

  test("each row shows the name, the description and what it reads", () => {
    const html = render(0);
    expect(html).toContain(
      '<span class="block text-sm font-medium">/connect</span><span class="text-muted-foreground block text-xs leading-snug">Connect a wearable</span><span class="text-muted-foreground block text-xs leading-snug">reads nothing</span>',
    );
    expect(html).toContain(">reads: oura, whoop</span>");
  });

  test("an empty list says so instead of showing a listbox", () => {
    const html = render(0, []);
    expect(html).toContain("No command with that name.");
    expect(html).not.toContain('role="listbox"');
  });
});

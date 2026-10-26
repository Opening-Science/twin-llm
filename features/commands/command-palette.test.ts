import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CommandPalette,
  commandOptionId,
  paletteKey,
  unknownCommandHint,
} from "./command-palette";
import { type Command, skillCommand } from "./registry";

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

  test("enter on an empty list is unknown, not a pick", () => {
    expect(paletteKey("Enter", 0, 0)).toBe("unknown");
    expect(paletteKey("Escape", 0, 0)).toBe("close");
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

  test("after enter on an unknown command it names the word and how to list commands", () => {
    expect(unknownCommandHint("/sleeep")).toBe(
      "No command /sleeep. Type / to see commands.",
    );
    const html = renderToStaticMarkup(
      createElement(CommandPalette, {
        commands: [],
        activeIndex: 0,
        onPick: () => {},
        notice: unknownCommandHint("/sleeep"),
      }),
    );
    expect(html).toContain(
      '<p role="status" class="text-muted-foreground px-3 py-2 text-xs">No command /sleeep. Type / to see commands.</p>',
    );
  });
});

describe("CommandPalette with skills", () => {
  const sleep = skillCommand({
    name: "sleep",
    description: "Chart the last nights of sleep.",
    sources: ["cohort-records", "wearable-context"],
    tools: ["coverage", "baseline_deviation"],
  });

  test("skills sit under a Skills heading and show what they read and may call", () => {
    const html = render(1, [commands[0]!, sleep]);
    expect(html).toContain(
      '<li role="presentation" class="text-eyebrow px-2 pt-2 pb-1">Skills</li><li><button type="button" role="option" id="command-option-sleep" aria-selected="true"',
    );
    expect(html).toContain(
      ">reads: Subjects and observations, Your linked wearables</span>",
    );
    expect(html).toContain(">may call: coverage, baseline_deviation</span>");
  });

  test("without skills there is no Skills heading and no tools line", () => {
    const html = render(0);
    expect(html).not.toContain(">Skills</li>");
    expect(html).not.toContain("may call");
  });
});

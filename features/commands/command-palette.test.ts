import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CommandPalette,
  commandDetailId,
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

  test("each row is one line: the name and the description (#455)", () => {
    const html = render(0);
    expect(html).toContain(
      '<span class="shrink-0 text-sm font-medium">/connect</span><span title="Connect a wearable" class="text-muted-foreground min-w-0 truncate text-xs">Connect a wearable</span></button>',
    );
    expect(html).toContain(
      '<span class="shrink-0 text-sm font-medium">/sleep</span><span title="Sleep summary" class="text-muted-foreground min-w-0 truncate text-xs">Sleep summary</span></button></li>',
    );
  });

  test("only the highlighted command carries its detail, under its row and beside the list", () => {
    const html = render(1);
    expect(commandDetailId("sleep")).toBe("command-detail-sleep");
    expect(html).toContain(
      '<button type="button" role="option" id="command-option-sleep" aria-selected="true" aria-describedby="command-detail-sleep"',
    );
    expect(html).toContain(
      '</button><div id="command-detail-sleep" class="text-muted-foreground text-xs leading-snug px-2 pt-1 pb-2 sm:hidden"><p>reads: oura, whoop</p></div></li>',
    );
    expect(html).toContain(
      '<aside aria-hidden="true" class="border-border hidden w-52 shrink-0 overflow-y-auto border-l p-3 sm:block"><p class="text-sm font-medium">/sleep</p><p class="text-muted-foreground mt-0.5 text-xs leading-snug">Sleep summary</p><div aria-hidden="true" class="text-muted-foreground text-xs leading-snug mt-2"><p>reads: oura, whoop</p></div></aside>',
    );
    expect(html).not.toContain('aria-describedby="command-detail-connect"');
    expect(html).not.toContain("reads nothing");
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
      '<div id="command-detail-sleep" class="text-muted-foreground text-xs leading-snug px-2 pt-1 pb-2 sm:hidden"><p>reads: Subjects and observations, Your linked wearables</p><p class="mt-1 font-mono text-[11px]">may call: coverage, baseline_deviation</p></div>',
    );
  });

  test("without skills there is no Skills heading and no tools line", () => {
    const html = render(0);
    expect(html).not.toContain(">Skills</li>");
    expect(html).not.toContain("may call");
  });
});

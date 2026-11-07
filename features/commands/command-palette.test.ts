import { describe, expect, test } from "bun:test";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CommandOption,
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
    createElement(CommandPalette, {
      commands: list,
      activeIndex,
      onPick: () => {},
      onHover: () => {},
    }),
  );

/*
 * Structure, not markup: these read attributes and text out of the rendered
 * HTML and ignore classes and attribute order, so a class reorder cannot
 * break them.
 */
const attribute = (attributes: string, name: string): string | null =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(attributes)?.[1] ?? null;

const textOf = (html: string): readonly string[] =>
  [...html.matchAll(/>([^<]+)</g)].map((match) => match[1] ?? "");

type Option = Readonly<{
  id: string | null;
  selected: string | null;
  describedBy: string | null;
}>;

/** Each option's id, aria-selected and aria-describedby, in order. */
const options = (html: string): readonly Option[] =>
  [...html.matchAll(/<button\b([^>]*\brole="option"[^>]*)>/g)].map((match) => ({
    id: attribute(match[1] ?? "", "id"),
    selected: attribute(match[1] ?? "", "aria-selected"),
    describedBy: attribute(match[1] ?? "", "aria-describedby"),
  }));

type Detail = Readonly<{
  id: string | null;
  hidden: string | null;
  lines: readonly string[];
}>;

/** Each command detail in the list (a div of one or two lines), in order. */
const listDetails = (html: string): readonly Detail[] => {
  const list = /<ul\b[^>]*role="listbox"[^>]*>([\s\S]*)<\/ul>/.exec(html)?.[1] ?? "";
  return [...list.matchAll(/<div\b([^>]*)>((?:<p\b[^>]*>[^<]*<\/p>)+)<\/div>/g)].map(
    (match) => ({
      id: attribute(match[1] ?? "", "id"),
      hidden: attribute(match[1] ?? "", "aria-hidden"),
      lines: textOf(match[2] ?? ""),
    }),
  );
};

/** The side pane's own attributes, whether anything inside it is aria-hidden, and its text. */
const aside = (html: string) => {
  const match = /<aside\b([^>]*)>([\s\S]*)<\/aside>/.exec(html);
  return {
    hidden: attribute(match?.[1] ?? "", "aria-hidden"),
    innerHidden: (match?.[2] ?? "").includes("aria-hidden"),
    text: textOf(match?.[2] ?? ""),
  };
};

/** The direct child elements of a rendered element. */
const childrenOf = (element: ReactElement): readonly ReactElement[] => {
  const { children } = element.props as Readonly<{ children?: unknown }>;
  return (Array.isArray(children) ? children : [children]).filter(isValidElement);
};

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
    expect(html).toMatch(/<ul\b[^>]*\brole="listbox"[^>]*\baria-label="Commands"/);
    expect(options(html).map((option) => [option.id, option.selected])).toEqual([
      ["command-option-connect", "false"],
      ["command-option-sleep", "true"],
    ]);
    expect(commandOptionId("sleep")).toBe("command-option-sleep");
  });

  test("each row is one line: the name and the description (#455)", () => {
    const buttons = [...render(0).matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)];
    expect(buttons.map((match) => textOf(match[1] ?? ""))).toEqual([
      ["/connect", "Connect a wearable"],
      ["/sleep", "Sleep summary"],
    ]);
    expect(render(0)).toMatch(
      /<span\b[^>]*\btitle="Sleep summary"[^>]*>Sleep summary<\/span>/,
    );
  });

  test("only the highlighted option is described, by its own detail under its row", () => {
    const html = render(1);
    expect(commandDetailId("sleep")).toBe("command-detail-sleep");
    expect(options(html).map((option) => option.describedBy)).toEqual([
      null,
      "command-detail-sleep",
    ]);
    // Every row shows its detail on a phone; only the highlighted one is
    // named by an option and kept for assistive technology.
    expect(listDetails(html)).toEqual([
      { id: null, hidden: "true", lines: ["reads nothing"] },
      { id: "command-detail-sleep", hidden: null, lines: ["reads: oura, whoop"] },
    ]);
  });

  test("the side pane is a hidden copy of the highlighted command only", () => {
    expect(aside(render(1))).toEqual({
      hidden: "true",
      innerHidden: false,
      text: ["/sleep", "Sleep summary", "reads: oura, whoop"],
    });
    expect(aside(render(0))).toEqual({
      hidden: "true",
      innerHidden: false,
      text: ["/connect", "Connect a wearable", "reads nothing"],
    });
  });

  test("pointing at a row highlights it, as in the @ menu (#455)", () => {
    const hovered: string[] = [];
    const picked: string[] = [];
    const row = CommandOption({
      command: commands[1]!,
      active: false,
      onPick: (command) => picked.push(command.name),
      onHover: () => hovered.push("sleep"),
    });
    const [button] = childrenOf(row);
    const handlers = button?.props as Readonly<{
      role?: string;
      onPointerEnter?: () => void;
    }>;
    expect(handlers.role).toBe("option");
    handlers.onPointerEnter?.();
    expect(hovered).toEqual(["sleep"]);
    expect(picked).toEqual([]);
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
        onHover: () => {},
        notice: unknownCommandHint("/sleeep"),
      }),
    );
    expect(html).toMatch(
      /<p\b[^>]*\brole="status"[^>]*>No command \/sleeep\. Type \/ to see commands\.<\/p>/,
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

  test("skills sit under a Skills heading and show what they read and may use, in words", () => {
    const html = render(1, [commands[0]!, sleep]);
    expect(html).toMatch(
      /<li\b[^>]*\brole="presentation"[^>]*>Skills<\/li><li><button\b[^>]*\bid="command-option-sleep"/,
    );
    expect(listDetails(html)[1]).toEqual({
      id: "command-detail-sleep",
      hidden: null,
      lines: [
        "reads: Subjects and observations, Your linked wearables",
        "may use: checks data coverage, compares with a baseline",
      ],
    });
    expect(html).not.toContain("baseline_deviation");
  });

  test("without skills there is no Skills heading and no tools line", () => {
    const html = render(0);
    expect(html).not.toContain(">Skills</li>");
    expect(html).not.toContain("may use");
  });
});

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Box3, Vector3 } from "three";

import {
  EnvironmentBar,
  EnvironmentPanel,
  ResearchLine,
  type EnvironmentBarProps,
} from "./environment-bar";
import {
  ABSTRACT_NOTE,
  FOLLOW_TIME,
  HOW_TO_MOVE,
  LIGHT_AT_MIDDAY,
  LIGHT_FOLLOWS_CLOCK,
  WALK_HINT,
} from "./environment-copy";
import { GROUND_DROP_M, groundPlacement } from "./environment-world";
import { RESEARCH_FOOTER_TEXT } from "@/features/shell/research-footer";

const noop = () => undefined;
const BAR: EnvironmentBarProps = {
  shown: true,
  preset: "studio",
  followTime: true,
  onPreset: noop,
  onFollowTime: noop,
};

const pressed = (html: string) =>
  [...html.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]*)</g)].map(([, on, text]) => [
    text,
    on,
  ]);
const note = (html: string) =>
  /<p[^>]*>([^<]*)<\/p>/.exec(html)?.[1]?.replace(/&#x27;/g, "'");

describe("EnvironmentBar", () => {
  test("studio: two presets, no clock switch, the abstraction line", () => {
    const html = renderToStaticMarkup(createElement(EnvironmentBar, BAR));
    expect(pressed(html)).toEqual([
      ["Studio", "true"],
      ["Outdoors, abstract", "false"],
    ]);
    expect(html).not.toContain('type="checkbox"');
    expect(note(html)).toBe(ABSTRACT_NOTE);
  });

  test("outdoors: the clock switch and what it does", () => {
    const following = renderToStaticMarkup(
      createElement(EnvironmentBar, { ...BAR, preset: "outdoors" }),
    );
    expect(pressed(following)).toEqual([
      ["Studio", "false"],
      ["Outdoors, abstract", "true"],
    ]);
    expect(following).toContain('type="checkbox" checked=""');
    expect(following).toContain(FOLLOW_TIME);
    expect(note(following)).toBe(`${ABSTRACT_NOTE} ${LIGHT_FOLLOWS_CLOCK}`);

    const fixed = renderToStaticMarkup(
      createElement(EnvironmentBar, { ...BAR, preset: "outdoors", followTime: false }),
    );
    expect(fixed).not.toContain('checked=""');
    expect(note(fixed)).toBe(`${ABSTRACT_NOTE} ${LIGHT_AT_MIDDAY}`);
  });
});

test("the walking help sits under How to move, open when nothing is stored", () => {
  const html = renderToStaticMarkup(createElement(EnvironmentBar, BAR));
  expect(html).toContain(
    `<details open="" class="text-muted-foreground"><summary class="text-foreground cursor-pointer">${HOW_TO_MOVE}</summary><p class="mt-1">${WALK_HINT}</p></details>`,
  );
  expect(html).not.toContain(RESEARCH_FOOTER_TEXT);
});

test("the research-use line from the shell footer stands on its own", () => {
  expect(renderToStaticMarkup(createElement(ResearchLine))).toBe(
    `<p class="twin-research-line">${RESEARCH_FOOTER_TEXT}</p>`,
  );
  expect(RESEARCH_FOOTER_TEXT).toBe(
    "Research-use visualisation only. This tool presents supplied data and model output and does not provide medical advice.",
  );
});

describe("EnvironmentPanel", () => {
  const render = (floating: boolean, open: boolean) =>
    renderToStaticMarkup(
      createElement(
        EnvironmentPanel,
        { label: "Anatomy", floating, open, onToggle: noop },
        createElement("p", null, "inside"),
      ),
    );
  const toggleText = (html: string) =>
    /aria-expanded="(true|false)"[^>]*><span>([^<]*)<\/span>/.exec(html)?.slice(1);

  test("inline it is a card that collapses under its title", () => {
    const closed = render(false, false);
    const id = /aria-controls="([^"]+)"/.exec(closed)?.[1];
    expect(closed.startsWith('<div class="collapsible-panel twin-panel">')).toBe(true);
    expect(toggleText(closed)).toEqual(["false", "Anatomy"]);
    expect(closed).toContain(`<div id="${id}" hidden="" class="collapsible-panel-body">`);
    const open = render(false, true);
    expect(toggleText(open)).toEqual(["true", "Anatomy"]);
    expect(open).not.toContain('hidden=""');
    expect(open).toContain("<p>inside</p>");
  });

  test("in the environment the same toggle reports and controls the content", () => {
    const closed = render(true, false);
    const id = /aria-controls="([^"]+)"/.exec(closed)?.[1];
    expect(
      closed.startsWith('<div class="collapsible-panel twin-environment-panel">'),
    ).toBe(true);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("data-open");
    expect(closed).toContain(`<div id="${id}" hidden="" class="collapsible-panel-body">`);
    const open = render(true, true);
    expect(open).toContain('aria-expanded="true"');
    expect(open).not.toContain('hidden=""');
    expect(open).toContain('data-open=""');
  });
});

describe("groundPlacement", () => {
  test("centres under the body, just below the floor pool", () => {
    const box = new Box3(new Vector3(-0.5, -0.15, 0), new Vector3(0.56, 0.28, 1.89));
    const placement = groundPlacement(box);
    expect(placement?.x).toBeCloseTo(0.03, 10);
    expect(placement?.y).toBeCloseTo(0.065, 10);
    expect(placement?.z).toBe(-0.006);
    expect(GROUND_DROP_M).toBe(0.006);
    expect(groundPlacement(new Box3())).toBeNull();
  });
});

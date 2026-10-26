import { describe, expect, test } from "bun:test";
import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ViewToolbar, type ViewToolbarProps } from "./view-toolbar";

const noop = () => undefined;

const BASE: ViewToolbarProps = {
  autoRotate: true,
  onReset: noop,
  onToggleRotate: noop,
  onZoom: noop,
};

/** Each button as [visible text, aria-label, aria-pressed], in order. */
const buttons = (props: ViewToolbarProps) =>
  [
    ...renderToStaticMarkup(createElement(ViewToolbar, props)).matchAll(
      /<button([^>]*)>([^<]*)<\/button>/g,
    ),
  ].map(([, attrs = "", text]) => [
    text,
    /aria-label="([^"]*)"/.exec(attrs)?.[1] ?? null,
    /aria-pressed="([^"]*)"/.exec(attrs)?.[1] ?? null,
  ]);

/** The nested groups as [label, button texts], in order. */
const groups = (props: ViewToolbarProps) =>
  renderToStaticMarkup(createElement(ViewToolbar, props))
    .split('<div role="group" aria-label="')
    .slice(2)
    .map((part) => part.slice(0, part.indexOf("</div>")))
    .map((part) => [
      part.slice(0, part.indexOf('"')),
      [...part.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(([, text]) => text),
    ]);

/** Every element with a click handler, depth first. */
const clickable = (node: ReactNode): readonly (() => void)[] =>
  Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ onClick?: () => void; children?: ReactNode }>(child)) return [];
    const own = child.props.onClick ? [child.props.onClick] : [];
    return [...own, ...clickable(child.props.children)];
  });

describe("ViewToolbar", () => {
  test("groups View, Show and the environment button", () => {
    expect(
      groups({
        ...BASE,
        landmarks: { shown: true, onToggle: noop },
        liveVitals: { on: true, onToggle: noop },
        environment: { active: true, onToggle: noop },
      }),
    ).toEqual([
      ["View", ["Reset view", "Pause", "+", "−"]],
      ["Show", ["Landmarks", "Live vitals"]],
    ]);
    expect(groups(BASE)).toEqual([["View", ["Reset view", "Pause", "+", "−"]]]);
  });

  test("is one labelled group of plain buttons", () => {
    const html = renderToStaticMarkup(createElement(ViewToolbar, BASE));
    expect(html.startsWith('<div role="group" aria-label="3D view"')).toBe(true);
    expect(html.match(/type="button"/g)?.length).toBe(4);
    expect(html.match(/role="group"/g)?.length).toBe(2);
  });

  test("scan: Pause names the action, Landmarks reports its state", () => {
    expect(buttons({ ...BASE, landmarks: { shown: true, onToggle: noop } })).toEqual([
      ["Reset view", null, null],
      ["Pause", null, null],
      ["+", "Zoom in", null],
      ["−", "Zoom out", null],
      ["Landmarks", null, "true"],
    ]);
    expect(
      buttons({
        ...BASE,
        autoRotate: false,
        landmarks: { shown: false, onToggle: noop },
      }),
    ).toEqual([
      ["Reset view", null, null],
      ["Rotate", null, null],
      ["+", "Zoom in", null],
      ["−", "Zoom out", null],
      ["Landmarks", null, "false"],
    ]);
  });

  test("demo: no landmarks to toggle", () => {
    expect(buttons(BASE)).toEqual([
      ["Reset view", null, null],
      ["Pause", null, null],
      ["+", "Zoom in", null],
      ["−", "Zoom out", null],
    ]);
  });

  test("environment: Enter names the action, and the same button exits", () => {
    expect(buttons({ ...BASE, environment: { active: false, onToggle: noop } })).toEqual([
      ["Reset view", null, null],
      ["Pause", null, null],
      ["+", "Zoom in", null],
      ["−", "Zoom out", null],
      ["Enter environment", null, null],
    ]);
    expect(
      buttons({ ...BASE, environment: { active: true, onToggle: noop } }).at(-1),
    ).toEqual(["Exit environment", null, null]);
  });

  test("environment: Enter is the primary action inline, Exit is not", () => {
    const envButton = (active: boolean) =>
      /<button[^>]*class="([^"]*)"[^>]*>[^<]*environment<\/button>/.exec(
        renderToStaticMarkup(
          createElement(ViewToolbar, {
            ...BASE,
            environment: { active, onToggle: noop },
          }),
        ),
      )?.[1] ?? "";
    expect(envButton(false)).toContain("bg-primary text-primary-foreground");
    expect(envButton(true)).not.toContain("bg-primary");
    expect(envButton(true)).toContain("border-input");
  });

  test("live vitals: one labelled toggle that reports its state", () => {
    expect(buttons({ ...BASE, liveVitals: { on: false, onToggle: noop } })).toEqual([
      ["Reset view", null, null],
      ["Pause", null, null],
      ["+", "Zoom in", null],
      ["−", "Zoom out", null],
      ["Live vitals", null, "false"],
    ]);
    expect(buttons({ ...BASE, liveVitals: { on: true, onToggle: noop } })[4]).toEqual([
      "Live vitals",
      null,
      "true",
    ]);
  });

  test("each button calls its own handler", () => {
    const calls: string[] = [];
    const tree = ViewToolbar({
      autoRotate: true,
      onReset: () => calls.push("reset"),
      onToggleRotate: () => calls.push("rotate"),
      onZoom: (direction) => calls.push(`zoom-${direction}`),
      landmarks: { shown: true, onToggle: () => calls.push("landmarks") },
      liveVitals: { on: false, onToggle: () => calls.push("live") },
      environment: { active: false, onToggle: () => calls.push("environment") },
    });
    for (const click of clickable(tree)) click();
    expect(calls).toEqual([
      "reset",
      "rotate",
      "zoom-in",
      "zoom-out",
      "landmarks",
      "live",
      "environment",
    ]);
  });

  test("Walk and Idle sit in Show after Live vitals; pressing the playing clip stops it", () => {
    const picked: (string | null)[] = [];
    const motion = {
      clip: "walk" as const,
      onSelect: (clip: string | null) => void picked.push(clip),
      unavailable: null,
    };
    expect(
      groups({ ...BASE, liveVitals: { on: false, onToggle: noop }, motion }),
    ).toEqual([
      ["View", ["Reset view", "Pause", "+", "−"]],
      ["Show", ["Live vitals", "Walk", "Idle"]],
    ]);
    expect(buttons({ ...BASE, motion }).slice(4)).toEqual([
      ["Walk", null, "true"],
      ["Idle", null, "false"],
    ]);
    for (const click of clickable(ViewToolbar({ ...BASE, motion })).slice(4)) click();
    expect(picked).toEqual([null, "idle"]);
  });

  test("without a rig the clips are disabled and say why", () => {
    const html = renderToStaticMarkup(
      createElement(ViewToolbar, {
        ...BASE,
        motion: {
          clip: null,
          onSelect: noop,
          unavailable: "This scan has no skeleton the walk can drive.",
        },
      }),
    );
    expect(html).toContain(
      'disabled="" title="This scan has no skeleton the walk can drive."',
    );
  });
});

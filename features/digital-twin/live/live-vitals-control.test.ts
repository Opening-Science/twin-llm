import { describe, expect, test } from "bun:test";
import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  LiveVitalOptions,
  type LiveVitalsControlModel,
  type LiveVitalMode,
} from "./live-vitals-control";

const BASE: LiveVitalsControlModel = {
  mode: null,
  onSelect: () => undefined,
  hrUnavailable: null,
  heartRate: {
    bpm: 70,
    overridden: false,
    nightPlayback: false,
    onChange: () => undefined,
    onReset: () => undefined,
  },
  glucose: {
    density: 0.5,
    status: "idle",
    unavailable: null,
    onDensity: () => undefined,
    onRetry: () => undefined,
  },
};

const clicks = (node: ReactNode): readonly (() => void)[] =>
  Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ onClick?: () => void; children?: ReactNode }>(child)) return [];
    return [
      ...(child.props.onClick ? [child.props.onClick] : []),
      ...clicks(child.props.children),
    ];
  });

describe("live vitals mode options", () => {
  test("offers HR first, then Glucose levels, with only one pressed mode", () => {
    for (const mode of [null, "hr", "glucose"] as const) {
      const html = renderToStaticMarkup(
        createElement(LiveVitalOptions, { model: { ...BASE, mode } }),
      );
      const options = [
        ...html.matchAll(/<button[^>]*aria-pressed="([^"]*)"[^>]*>([^<]*)<\/button>/g),
      ].map(([, pressed, label]) => [label, pressed]);
      expect(options).toEqual([
        ["HR", String(mode === "hr")],
        ["Glucose levels", String(mode === "glucose")],
      ]);
      expect(html.includes("Vessel particles")).toBe(mode === "glucose");
      expect(html.includes("Heart rate")).toBe(mode === "hr");
    }
  });

  test("selects the chosen mode and pressing it again turns it off", () => {
    for (const mode of [null, "hr", "glucose"] as const) {
      const selected: LiveVitalMode[] = [];
      const tree = LiveVitalOptions({
        model: { ...BASE, mode, onSelect: (next) => selected.push(next) },
      });
      for (const click of clicks(tree)) click();
      expect(selected).toEqual([
        mode === "hr" ? null : "hr",
        mode === "glucose" ? null : "glucose",
      ]);
    }
  });

  test("reduced motion does not prevent glucose selection", () => {
    const html = renderToStaticMarkup(
      createElement(LiveVitalOptions, {
        model: { ...BASE, hrUnavailable: "HR animation is off with reduced motion." },
      }),
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>HR<\/button>/);
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*>Glucose levels<\/button>/);
    expect(html).toContain("HR animation is off with reduced motion.");
  });

  test("an unavailable selected mode can still be turned off", () => {
    const html = renderToStaticMarkup(
      createElement(LiveVitalOptions, {
        model: {
          ...BASE,
          mode: "glucose",
          glucose: {
            ...BASE.glucose,
            unavailable: "Particles are available only with BodyParts3D.",
          },
        },
      }),
    );
    expect(html).toMatch(
      /<button(?![^>]*disabled="")[^>]*aria-pressed="true"[^>]*>Glucose levels<\/button>/,
    );
    expect(html).toContain('disabled=""');
  });
});

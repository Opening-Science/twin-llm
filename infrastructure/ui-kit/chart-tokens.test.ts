import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { contrast, inGamut, readToken, type Oklch } from "./oklch-contrast";

/**
 * Chart series colours must stay legible as lines and dots: WCAG 1.4.11 asks
 * 3:1 for non-text graphics against what they sit on, here `--card`. The
 * check reads the real `globals.css`, so a token edit that breaks contrast
 * fails here instead of shipping.
 */

const css = readFileSync(join(import.meta.dir, "../../app/globals.css"), "utf8");

const block = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf("\n}", start));
};

const token = (scope: string, name: string): Oklch => readToken(css, scope, name);

const CHART = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const;

describe.each([":root", ".dark"])("chart tokens in %s", (scope) => {
  const card = token(scope, "card");

  test.each([...CHART])(
    "%s clears 3:1 against the card and is a real sRGB colour",
    (name) => {
      const colour = token(scope, name);
      expect(inGamut(colour)).toBe(true);
      expect(contrast(colour, card)).toBeGreaterThanOrEqual(3);
    },
  );

  // A grey accent (light mode's charcoal) has no hue to collide with; the
  // check matters where the accent is a colour, as the dark-mode blue is.
  test.each([...CHART])(
    "%s hue sits at least 30° from a coloured accent's hue",
    (name) => {
      const [, chroma, accent] = token(scope, "primary");
      if (chroma < 0.02) return;
      const hue = token(scope, name)[2];
      const gap = Math.abs(hue - accent) % 360;
      expect(Math.min(gap, 360 - gap)).toBeGreaterThanOrEqual(30);
    },
  );

  test("no chart colour is the interactive accent", () => {
    const primary = token(scope, "primary");
    expect(CHART.some((n) => token(scope, n).join() === primary.join())).toBe(false);
  });
});

test("every chart token is mapped into the Tailwind theme", () => {
  const theme = block("@theme inline");
  expect(CHART.filter((n) => theme.includes(`--color-${n}: var(--${n});`))).toEqual([
    ...CHART,
  ]);
});

/** Sleep stages, deepest first. */
const STAGES = ["stage-deep", "stage-core", "stage-rem", "stage-awake"] as const;

describe.each([":root", ".dark"])("chart kit tokens in %s", (scope) => {
  const card = token(scope, "card");
  const track = token(scope, "chart-track");

  test("the track is a real colour, set apart from the card", () => {
    expect(inGamut(track)).toBe(true);
    expect(track.join()).not.toBe(card.join());
  });

  // A ring's arc, a bar over its future and a line over its band all sit on
  // the track, so each series owes 3:1 there as it does on the card.
  test.each([...CHART])("%s clears 3:1 against the track", (name) => {
    expect(contrast(token(scope, name), track)).toBeGreaterThanOrEqual(3);
  });

  test.each([...STAGES])("%s clears 3:1 against the card", (name) => {
    const colour = token(scope, name);
    expect(inGamut(colour)).toBe(true);
    expect(contrast(colour, card)).toBeGreaterThanOrEqual(3);
  });

  test("neighbouring stages are told apart, and the deepest stands out most", () => {
    const steps = STAGES.map((n) => token(scope, n));
    for (let i = 1; i < steps.length; i += 1) {
      expect(contrast(steps[i - 1]!, steps[i]!)).toBeGreaterThanOrEqual(1.3);
    }
    const against = steps.map((s) => contrast(s, card));
    expect(against).toEqual([...against].sort((p, q) => q - p));
  });
});

test("the kit's roles are mapped into the Tailwind theme", () => {
  const theme = block("@theme inline");
  const roles = ["chart-track", ...STAGES];
  expect(roles.filter((n) => !theme.includes(`--color-${n}: var(--${n});`))).toEqual([]);
  expect(theme).toContain("--color-chart-reference: var(--chart-5);");
});

test("kit cards get one radius larger than the existing scale", () => {
  const theme = block("@theme inline");
  const px = (name: string): number =>
    Number(new RegExp(`--${name}:\\s*([\\d.]+)px`).exec(theme)?.[1]);
  const base = Number(/--radius:\s*([\d.]+)rem/.exec(css)?.[1]) * 16;
  expect(px("radius-card")).toBeGreaterThan(base + 4);
});

test("hero, insight and axis type steps descend in size", () => {
  const theme = block("@theme inline");
  const rem = (name: string): number =>
    Number(new RegExp(`--text-${name}:\\s*([\\d.]+)rem`).exec(theme)?.[1]);
  const [hero, insight, axis] = [rem("hero"), rem("insight"), rem("axis")];
  expect(hero).toBeGreaterThan(insight);
  expect(insight).toBeGreaterThan(axis);
  // Axis labels stay readable on a phone.
  expect(axis * 16).toBeGreaterThanOrEqual(12);
});

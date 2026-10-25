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

  test.each(CHART)("%s clears 3:1 against the card and is a real sRGB colour", (name) => {
    const colour = token(scope, name);
    expect(inGamut(colour)).toBe(true);
    expect(contrast(colour, card)).toBeGreaterThanOrEqual(3);
  });

  // A grey accent (light mode's charcoal) has no hue to collide with; the
  // check matters where the accent is a colour, as the dark-mode blue is.
  test.each(CHART)("%s hue sits at least 30° from a coloured accent's hue", (name) => {
    const [, chroma, accent] = token(scope, "primary");
    if (chroma < 0.02) return;
    const hue = token(scope, name)[2];
    const gap = Math.abs(hue - accent) % 360;
    expect(Math.min(gap, 360 - gap)).toBeGreaterThanOrEqual(30);
  });

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

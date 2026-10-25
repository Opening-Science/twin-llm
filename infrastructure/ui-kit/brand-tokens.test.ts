import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { contrast, inGamut, readToken, toHex } from "./oklch-contrast";

/**
 * The palette is the Open Science Foundation brand guide's. These tests read
 * the real globals.css, so a token edit that drifts from the guide or breaks
 * WCAG AA fails here. docs/brand.md carries the same table for people.
 */

const css = readFileSync(join(import.meta.dir, "../../app/globals.css"), "utf8");
const token = (scope: string, name: string) => readToken(css, scope, name);

/** Tokens that are exactly a brand-guide colour (tokens/tokens.css). */
const BRAND: Record<":root" | ".dark", Record<string, string>> = {
  ":root": {
    background: "#f8f8f4", // cream-light
    card: "#ffffff", // white
    foreground: "#1d1d1d", // black
    "muted-foreground": "#646363", // gray
    input: "#6f6e66", // cream-darker
    primary: "#323232", // button
    "primary-foreground": "#ffffff",
    ring: "#1c4e8f", // blue-ink
    muted: "#efeee7", // cream
  },
  ".dark": {
    background: "#1d1d1d", // black
    foreground: "#f8f8f4", // cream-light
    "muted-foreground": "#c0beb2", // cream-dark
    primary: "#73adff", // blue
    "primary-foreground": "#1d1d1d",
    ring: "#73adff",
    muted: "#323232", // button
  },
};

describe.each([":root", ".dark"] as const)("brand colours in %s", (scope) => {
  test.each(Object.entries(BRAND[scope]))("--%s renders as %s", (name, hex) => {
    expect(toHex(token(scope, name))).toBe(hex);
  });
});

/** Text on a surface owes 4.5:1 (WCAG 1.4.3). */
const TEXT: readonly (readonly [string, string])[] = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["foreground", "muted"],
  ["foreground", "popover"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["muted-foreground", "popover"],
  ["primary-foreground", "primary"],
  ["primary", "background"],
  ["primary", "card"],
  ["winner", "background"],
  ["winner", "card"],
  ["destructive", "background"],
  ["destructive", "card"],
  ["destructive-foreground", "destructive"],
];

/** A control edge or focus ring owes 3:1 (WCAG 1.4.11). */
const EDGE: readonly (readonly [string, string])[] = [
  ["input", "background"],
  ["input", "card"],
  ["ring", "background"],
  ["ring", "card"],
];

describe.each([":root", ".dark"] as const)("contrast in %s", (scope) => {
  test.each(TEXT)("%s on %s clears 4.5:1", (fg, bg) => {
    expect(contrast(token(scope, fg), token(scope, bg))).toBeGreaterThanOrEqual(4.5);
  });

  test.each(EDGE)("%s on %s clears 3:1", (fg, bg) => {
    expect(contrast(token(scope, fg), token(scope, bg))).toBeGreaterThanOrEqual(3);
  });

  test.each([...TEXT, ...EDGE].flat())("--%s is a real sRGB colour", (name) => {
    expect(inGamut(token(scope, name))).toBe(true);
  });
});

test("the light-mode brand blue is never a text or accent token", () => {
  // #73adff is 2.3:1 on white; the guide keeps it for hover and identity.
  const light = ["primary", "ring", "foreground", "muted-foreground"];
  expect(light.map((n) => toHex(token(":root", n)))).not.toContain("#73adff");
});

test("both brand faces are the sans and mono roles, with system fallbacks", () => {
  expect(css).toContain('--font-sans: "Selecta", ui-sans-serif, system-ui, sans-serif;');
  expect(css).toContain(
    '--font-mono: "ABCDiatypeSemiMono", ui-monospace, "SFMono-Regular", Menlo, monospace;',
  );
  expect(css.match(/font-display: swap;/g)?.length).toBe(10);
});

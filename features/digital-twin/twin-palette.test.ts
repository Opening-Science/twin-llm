import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readToken, toHex } from "@/infrastructure/ui-kit/oklch-contrast";

import {
  BRAND_PALETTE,
  cssColourToHex,
  hexNumber,
  resolveTwinPalette,
  TWIN_TOKENS,
  type TwinToken,
} from "./twin-palette";
import { readDocumentPalette } from "./use-twin-palette";

const css = readFileSync(join(import.meta.dir, "../../app/globals.css"), "utf8");

describe("cssColourToHex", () => {
  test("reads the oklch() globals.css writes, as the hex it renders", () => {
    expect(cssColourToHex("oklch(0.52 0.08 195)")).toBe("#1e7777");
    expect(cssColourToHex(" oklch(0.7422 0.1341 257.2) ")).toBe("#73adff");
    expect(cssColourToHex("oklch(1 0 0)")).toBe("#ffffff");
  });

  test("reads the lab() the CSS build serves, as Chromium returns it for .dark", () => {
    // Read from getComputedStyle on /digital-twin in the dark theme.
    expect(cssColourToHex("lab(69.3466% -1.67272 -47.2019)")).toBe(
      BRAND_PALETTE.dark.ring,
    );
    expect(cssColourToHex("lab(70.901% -32.6927 -9.88522)")).toBe(
      BRAND_PALETTE.dark["chart-1"],
    );
    expect(cssColourToHex("lab(10.7728% 0 0)")).toBe(BRAND_PALETTE.dark.background);
    expect(cssColourToHex("lab(14.16% 0 0)")).toBe(BRAND_PALETTE.dark.card);
    expect(cssColourToHex("lab(100 0 0 / 0.5)")).toBe("#ffffff");
  });

  test("reads lab() with a bare leading dot, as Chromium returns it for light", () => {
    expect(cssColourToHex("lab(97.4934% -.522524 1.93361)")).toBe(
      BRAND_PALETTE.light.background,
    );
    expect(cssColourToHex("lab(32.664% 2.39359 -41.5621)")).toBe(
      BRAND_PALETTE.light.ring,
    );
  });

  test("reads oklch with a percentage lightness, degrees and an alpha", () => {
    expect(cssColourToHex("oklch(52% 0.08 195deg)")).toBe("#1e7777");
    expect(cssColourToHex("oklch(0.52 0.08 195 / 0.5)")).toBe("#1e7777");
  });

  test("reads hex and rgb() in lower case", () => {
    expect(cssColourToHex("#1C4E8F")).toBe("#1c4e8f");
    expect(cssColourToHex("#FfF")).toBe("#ffffff");
    expect(cssColourToHex("rgb(28, 78, 143)")).toBe("#1c4e8f");
    expect(cssColourToHex("rgb(28 78 143 / 50%)")).toBe("#1c4e8f");
  });

  test("anything else is not a colour it can hand to three.js", () => {
    expect(cssColourToHex("")).toBeNull();
    expect(cssColourToHex("var(--chart-1)")).toBeNull();
    expect(cssColourToHex("color-mix(in oklab, red, blue)")).toBeNull();
    expect(cssColourToHex("#12345")).toBeNull();
  });
});

describe("resolveTwinPalette", () => {
  test("takes each token from the reader", () => {
    const read = (token: TwinToken) =>
      token === "ring" ? "oklch(0.4272 0.12 256.5)" : "";
    expect(resolveTwinPalette("dark", read).ring).toBe("#1c4e8f");
  });

  test("falls back to the brand hex of the theme, token by token", () => {
    const read = (token: TwinToken) =>
      token === "chart-1" ? "#123456" : token === "card" ? "not a colour" : "";
    expect(resolveTwinPalette("light", read)).toEqual({
      ...BRAND_PALETTE.light,
      "chart-1": "#123456",
    });
    expect(resolveTwinPalette("dark", () => "")).toEqual(BRAND_PALETTE.dark);
  });

  test("with no document, the palette is the brand fallback", () => {
    expect(readDocumentPalette("light")).toEqual(BRAND_PALETTE.light);
    expect(readDocumentPalette("dark")).toEqual(BRAND_PALETTE.dark);
  });
});

describe("brand fallback", () => {
  test.each([
    ["light", ":root"],
    ["dark", ".dark"],
  ] as const)("the %s fallback is what globals.css renders", (theme, scope) => {
    expect(
      Object.fromEntries(
        TWIN_TOKENS.map((token) => [token, toHex(readToken(css, scope, token))]),
      ),
    ).toEqual(BRAND_PALETTE[theme]);
  });

  test("the resolver turns the tokens as written into the fallback", () => {
    const tokens = (scope: string) => (token: TwinToken) => {
      const [l, c, h] = readToken(css, scope, token);
      return `oklch(${l} ${c} ${h})`;
    };
    expect(resolveTwinPalette("light", tokens(":root"))).toEqual(BRAND_PALETTE.light);
    expect(resolveTwinPalette("dark", tokens(".dark"))).toEqual(BRAND_PALETTE.dark);
  });
});

test("hexNumber gives three.js the same colour as a number", () => {
  expect(hexNumber("#1d1d1d")).toBe(0x1d1d1d);
  expect(hexNumber("#ffffff")).toBe(0xffffff);
});

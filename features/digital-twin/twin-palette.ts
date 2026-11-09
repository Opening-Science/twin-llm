import { toHex } from "@/infrastructure/ui-kit/oklch-contrast";

/**
 * The brand colours the 3D twin draws with, as `#rrggbb`.
 *
 * three.js needs real colour values, not `var(--chart-1)`, so the twin reads
 * the tokens from `globals.css` at runtime and converts them here. Where there
 * is no document (server render, tests) or a token does not parse, it falls
 * back to the brand hex from `docs/brand.md`; a test checks that the fallback
 * is what `globals.css` renders, so the two cannot drift.
 *
 * Pure: the caller passes in how to read a token (`use-twin-palette.ts` does
 * it with getComputedStyle).
 */

export const TWIN_TOKENS = [
  "background",
  "card",
  "foreground",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
] as const;

export type TwinToken = (typeof TWIN_TOKENS)[number];

export type TwinTheme = "light" | "dark";

export type TwinPalette = Readonly<Record<TwinToken, string>>;

export const BRAND_PALETTE: Readonly<Record<TwinTheme, TwinPalette>> = {
  light: {
    background: "#f8f8f4",
    card: "#ffffff",
    foreground: "#1d1d1d",
    ring: "#1c4e8f",
    "chart-1": "#1e7777",
    "chart-2": "#926e10",
    "chart-3": "#974391",
    "chart-4": "#6a51a4",
    "chart-5": "#6f6e66",
  },
  dark: {
    background: "#1d1d1d",
    card: "#242424",
    foreground: "#f8f8f4",
    ring: "#73adff",
    "chart-1": "#50bfbe",
    "chart-2": "#dbb155",
    "chart-3": "#d285cb",
    "chart-4": "#aa95e8",
    "chart-5": "#c0beb2",
  },
};

const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const NUMBER = String.raw`(-?[\d.]+)`;
const OKLCH = new RegExp(
  String.raw`^oklch\(\s*${NUMBER}(%?)\s+${NUMBER}\s+${NUMBER}(?:deg)?\s*(?:/\s*[\d.]+%?\s*)?\)$`,
  "i",
);
const LAB = new RegExp(
  String.raw`^lab\(\s*${NUMBER}%?\s+${NUMBER}\s+${NUMBER}\s*(?:/\s*[\d.]+%?\s*)?\)$`,
  "i",
);
const RGB = new RegExp(
  String.raw`^rgba?\(\s*${NUMBER}[\s,]+${NUMBER}[\s,]+${NUMBER}\s*(?:[,/]\s*[\d.]+%?\s*)?\)$`,
  "i",
);

const byte = (value: number): string =>
  Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, "0");

type Triple = readonly [number, number, number];

type Matrix = readonly [Triple, Triple, Triple];

const dot = (row: Triple, [x, y, z]: Triple): number =>
  row[0] * x + row[1] * y + row[2] * z;

const multiply = ([r0, r1, r2]: Matrix, v: Triple): Triple => [
  dot(r0, v),
  dot(r1, v),
  dot(r2, v),
];

// CSS Color 4 reference matrices: D50 to D65 (Bradford), then XYZ D65 to linear sRGB.
const D50_TO_D65: Matrix = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const XYZ_TO_LINEAR_SRGB: Matrix = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const D50_WHITE: Triple = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const LAB_E = 216 / 24389;
const LAB_K = 24389 / 27;

/** CIE Lab (D50, as CSS defines it) to linear sRGB. */
const labToLinearSrgb = (l: number, a: number, b: number): Triple => {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inverse = (f: number) => (f ** 3 > LAB_E ? f ** 3 : (116 * f - 16) / LAB_K);
  const xyz: Triple = [
    inverse(fx) * D50_WHITE[0],
    (l > LAB_K * LAB_E ? fy ** 3 : l / LAB_K) * D50_WHITE[1],
    inverse(fz) * D50_WHITE[2],
  ];
  return multiply(XYZ_TO_LINEAR_SRGB, multiply(D50_TO_D65, xyz));
};

const encode = (linear: number): number => {
  const x = Math.min(1, Math.max(0, linear));
  return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
};

/**
 * A CSS colour as lower-case `#rrggbb`, or null when it is not one this reads.
 * `globals.css` writes `oklch()`, but the CSS build serves the same tokens as
 * `lab()`, which is what getComputedStyle hands back. Hex and `rgb()` too.
 */
export const cssColourToHex = (value: string): string | null => {
  const text = value.trim();
  const hex6 = HEX6.exec(text);
  if (hex6) return `#${hex6[1]!.toLowerCase()}`;
  const hex3 = HEX3.exec(text);
  if (hex3)
    return `#${[hex3[1], hex3[2], hex3[3]].map((d) => d + d).join("")}`.toLowerCase();
  const oklch = OKLCH.exec(text);
  if (oklch) {
    const lightness = Number(oklch[1]) / (oklch[2] === "%" ? 100 : 1);
    return toHex([lightness, Number(oklch[3]), Number(oklch[4])]);
  }
  const lab = LAB.exec(text);
  if (lab) {
    const linear = labToLinearSrgb(Number(lab[1]), Number(lab[2]), Number(lab[3]));
    return `#${linear.map((c) => byte(encode(c))).join("")}`;
  }
  const rgb = RGB.exec(text);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((c) => byte(Number(c))).join("")}`;
  return null;
};

/** Every twin token for a theme, each read with `read` or else the brand hex. */
export const resolveTwinPalette = (
  theme: TwinTheme,
  read: (token: TwinToken) => string,
): TwinPalette =>
  Object.fromEntries(
    TWIN_TOKENS.map((token) => [
      token,
      cssColourToHex(read(token)) ?? BRAND_PALETTE[theme][token],
    ]),
  ) as TwinPalette;

/** `#rrggbb` as the number three.js lights and the environment look take. */
export const hexNumber = (hex: string): number => Number.parseInt(hex.slice(1), 16);

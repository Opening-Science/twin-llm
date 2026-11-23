/**
 * OKLCH to sRGB and WCAG contrast, for the token tests that read globals.css.
 * Pure, no I/O. Matrices are Björn Ottosson's reference values.
 */

export type Oklch = readonly [number, number, number];

/** The `--name: oklch(L C H)` value inside one `selector { … }` block. */
export const readToken = (css: string, selector: string, name: string): Oklch => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} missing`);
  const block = css.slice(start, css.indexOf("\n}", start));
  const m = new RegExp(`--${name}:\\s*oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`).exec(
    block,
  );
  if (!m) throw new Error(`--${name} missing in ${selector}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

export const linearSrgb = ([L, C, H]: Oklch): readonly [number, number, number] => {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};

/** Linear sRGB to OKLCH, the inverse of `linearSrgb`; hue in degrees, 0..360. */
export const oklchOfLinear = ([r, g, b]: readonly [number, number, number]): Oklch => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = (Math.atan2(bb, a) * 180) / Math.PI;
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    Math.hypot(a, bb),
    hue < 0 ? hue + 360 : hue,
  ];
};

export const inGamut = (c: Oklch): boolean =>
  linearSrgb(c).every((v) => v >= -0.001 && v <= 1.001);

const clamp = (v: number): number => Math.min(1, Math.max(0, v));

/** The 8-bit sRGB hex a token renders as, lower case. */
export const toHex = (c: Oklch): string =>
  "#" +
  linearSrgb(c)
    .map((v) => {
      const x = clamp(v);
      const encoded = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
      return Math.round(encoded * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("");

export const luminance = (c: Oklch): number => {
  const [r, g, b] = linearSrgb(c).map(clamp);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

export const contrast = (x: Oklch, y: Oklch): number => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi! + 0.05) / (lo! + 0.05);
};

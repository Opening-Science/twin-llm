import Image from "next/image";

/**
 * "By" the Open Science Foundation, with the foundation's own lockup.
 *
 * The artwork is the brand guide's unmodified file (public/brand/, under the
 * foundation's Brand Assets Permission, not Apache-2.0): positive on light, negative
 * on dark, never recoloured. TwinLLM stays the product name; the logo only
 * says who makes it. The SVG carries its own clear space around the mark.
 */

export const FOUNDATION_NAME = "Open Science Foundation";
export const FOUNDATION_URL = "https://opening.science";

export const LOGO_POSITIVE = "/brand/Open-Science-Foundation_logo_positive_original.svg";
export const LOGO_NEGATIVE = "/brand/Open-Science-Foundation_logo_negative_original.svg";

/** The lockup's own proportions (viewBox 519.74 × 236.98), scaled to 120 px wide. */
const WIDTH = 120;
const HEIGHT = 55;

export const BrandAttribution = () => (
  <a
    href={FOUNDATION_URL}
    target="_blank"
    rel="noreferrer"
    className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-md text-xs transition-colors"
  >
    <span>By</span>
    <Image
      src={LOGO_POSITIVE}
      alt={FOUNDATION_NAME}
      width={WIDTH}
      height={HEIGHT}
      unoptimized
      className="dark:hidden"
    />
    <Image
      src={LOGO_NEGATIVE}
      alt={FOUNDATION_NAME}
      width={WIDTH}
      height={HEIGHT}
      unoptimized
      className="hidden dark:block"
    />
  </a>
);

import Image from "next/image";

/**
 * "By" and the Open Science Foundation lockup, linking to the foundation.
 * The files in `public/brand/` are the brand guide's own, used under the
 * foundation's brand-asset permission: never recoloured and never resampled
 * (`unoptimized` serves the original SVG). The positive lockup shows in the
 * light theme, the negative one in the dark. TwinLLM stays the product name;
 * the logo only says who makes it.
 */

export const FOUNDATION_NAME = "Open Science Foundation";
export const FOUNDATION_URL = "https://opening.science";
export const LOCKUP = {
  positive: "/brand/Open-Science-Foundation_logo_positive_original.svg",
  negative: "/brand/Open-Science-Foundation_logo_negative_original.svg",
  width: 120,
  height: 55,
} as const;

export const BrandLine = () => (
  <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
    By
    <a
      href={FOUNDATION_URL}
      target="_blank"
      rel="noreferrer"
      className="inline-flex rounded-sm"
    >
      <Image
        unoptimized
        src={LOCKUP.positive}
        width={LOCKUP.width}
        height={LOCKUP.height}
        alt={FOUNDATION_NAME}
        className="dark:hidden"
      />
      <Image
        unoptimized
        src={LOCKUP.negative}
        width={LOCKUP.width}
        height={LOCKUP.height}
        alt={FOUNDATION_NAME}
        className="hidden dark:block"
      />
    </a>
  </span>
);

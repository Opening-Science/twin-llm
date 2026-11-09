/**
 * The vendor logos TwinLLM may show, each the vendor's own file, unchanged,
 * with the rules from its brand guidelines (PROVENANCE.md). Screens take a
 * logo from here rather than naming a file, so the size, the clear space
 * and the attribution word come with it.
 *
 * Oura has no entry: its only official mark is the ŌURA wordmark, whose
 * files are not in the repository yet, so Oura is shown by its name.
 */

import type { VendorLogo } from "./types";

export const VENDOR_LOGOS = {
  /** The outline circle; black on light, white on dark; 30px or more; "Data by" before it. */
  whoop: {
    src: "/brand/vendors/whoop/whoop-circle-black.svg",
    darkSrc: "/brand/vendors/whoop/whoop-circle-white.svg",
    alt: "WHOOP",
    width: 30,
    height: 30,
    size: 30,
    attribution: "Data by",
  },
  /** The colour heart, the same file on both themes. */
  googleHealth: {
    src: "/brand/vendors/google-health/google-health-heart.png",
    alt: "Google Health",
    width: 600,
    height: 600,
    size: 30,
  },
} as const satisfies Record<string, VendorLogo>;

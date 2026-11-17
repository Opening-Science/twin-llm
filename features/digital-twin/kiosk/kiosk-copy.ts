/**
 * Words on the kiosk. The kiosk stands in a public room in front of people
 * who never signed in, so it shows a synthetic body only and says so.
 */

export const KIOSK_TITLE = "TwinLLM";

/** Under the title, always shown: whose body this is. */
export const KIOSK_SUBTITLE = "A digital twin of a synthetic person";

/** The line under the twin, always on screen. */
export const KIOSK_FOOTER =
  "Research software of the Open Science Foundation. The body is synthetic: not a scan of anyone, and not advice.";

/** The 3D view's accessible name. */
export const KIOSK_VIEW_LABEL = "Synthetic body, turning slowly";

/** Without WebGL there is no twin to show. */
export const KIOSK_NEEDS_WEBGL = "This screen needs WebGL to show the twin.";

/** The body file did not load. */
export const KIOSK_BODY_MISSING = "The twin could not be loaded on this screen.";

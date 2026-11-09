import type { HeadingLevel } from "./types";

/**
 * The element for a card heading level. A plain module, not a client one,
 * so cards rendered on the server can use it.
 */
export const HEADING = { 2: "h2", 3: "h3", 4: "h4" } as const satisfies Record<
  HeadingLevel,
  "h2" | "h3" | "h4"
>;

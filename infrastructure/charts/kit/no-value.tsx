import type { ChartState } from "./types";

/**
 * A value that is not there yet: a dash to the eye, and words to a screen
 * reader, which would otherwise read a bare dash (or nothing) aloud.
 */
export const NoValue = ({ state = "empty" }: { readonly state?: ChartState }) => (
  <>
    <span aria-hidden="true">–</span>
    <span className="sr-only">{state === "loading" ? "loading" : "no data"}</span>
  </>
);

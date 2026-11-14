import { EMPTY_VALUE } from "@/infrastructure/format-measure";

import type { ChartState } from "./types";

/**
 * A value that is not there yet: the app's one dash (`EMPTY_VALUE`) to the
 * eye, and words to a screen reader, which would otherwise read a bare dash
 * (or nothing) aloud.
 */
export const NoValue = ({ state = "empty" }: { readonly state?: ChartState }) => (
  <>
    <span aria-hidden="true">{EMPTY_VALUE}</span>
    <span className="sr-only">{state === "loading" ? "loading" : "no data"}</span>
  </>
);

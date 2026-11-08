/**
 * The thread's columns when the Outputs panel is there (from `xl`): answers on
 * the left, the panel on the right, 18rem wide or 30rem when an output is
 * enlarged. The prompt bar sits outside that grid (it is sticky to the scroll
 * pane), so it gets the same space on its right; then the composer is centred
 * over the answers instead of over the whole pane. Both come from here so the
 * two widths cannot drift apart.
 */

export const threadGridClass = (withPanel: boolean, large: boolean): string =>
  withPanel
    ? `flex-1 px-(--page-gutter) py-6 xl:grid xl:items-start xl:gap-6 ${large ? "xl:grid-cols-[minmax(0,1fr)_30rem]" : "xl:grid-cols-[minmax(0,1fr)_18rem]"}`
    : "flex-1 px-(--page-gutter) py-6";

/**
 * Right padding for the prompt bar: the panel's width plus 3rem, which is the
 * `xl:gap-6` (1.5rem) of `threadGridClass` and the page gutter (`--page-gutter`
 * in `globals.css`, 1.5rem from 640px). Change the gap or the gutter and this
 * 3rem has to follow.
 */
export const composerInsetClass = (withPanel: boolean, large: boolean): string =>
  withPanel ? (large ? "xl:pr-[calc(30rem+3rem)]" : "xl:pr-[calc(18rem+3rem)]") : "";

/**
 * Which chart colour each category draws in. Four hues for more categories
 * than four, so the category's word is always written beside its chart: the
 * colour helps, the label decides. chart-5's grey is never a category; it is
 * the reference series, drawn under today.
 *
 * The kit and the screens that use it import this one table, so the mapping
 * is said once.
 */

export type SeriesToken = "chart-1" | "chart-2" | "chart-3" | "chart-4";

export const CATEGORY_TOKEN = {
  sleep: "chart-4",
  heart: "chart-3",
  hrv: "chart-3",
  activity: "chart-2",
  steps: "chart-2",
  readiness: "chart-1",
  recovery: "chart-1",
  vitals: "chart-1",
} as const satisfies Record<string, SeriesToken>;

export type Category = keyof typeof CATEGORY_TOKEN;

/** Research conditions and datasets take the series in order, then repeat. */
const SERIES: readonly SeriesToken[] = ["chart-1", "chart-2", "chart-3", "chart-4"];

export const conditionToken = (index: number): SeriesToken =>
  SERIES[((Math.trunc(index) % SERIES.length) + SERIES.length) % SERIES.length]!;

/**
 * The text-colour class for a token, written out so Tailwind finds every
 * class in the source. Marks draw with `fill-current` / `stroke-current`.
 */
const TEXT_CLASS: Record<SeriesToken | "chart-reference", string> = {
  "chart-1": "text-chart-1",
  "chart-2": "text-chart-2",
  "chart-3": "text-chart-3",
  "chart-4": "text-chart-4",
  "chart-reference": "text-chart-reference",
};

export const tokenTextClass = (token: SeriesToken | "chart-reference"): string =>
  TEXT_CLASS[token];

export const categoryTextClass = (category: Category): string =>
  TEXT_CLASS[CATEGORY_TOKEN[category]];

/** The reference series, always grey. */
export const REFERENCE_TEXT_CLASS = TEXT_CLASS["chart-reference"];

import type { ViewOf, ViewPoint } from "@/infrastructure/chat-view";

/**
 * What the time chart needs from a view: the points exactly as the audited
 * query returned them (every reading, at its own time), the view's window as
 * the x range, and how many decimals the values carry. No points gives null,
 * so the view says there were none instead of drawing.
 */
export type ViewChart = Readonly<{
  points: readonly ViewPoint[];
  domain: readonly [number, number];
  decimals: number;
}>;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A plain date is the whole UTC day, as the query tools read a window. */
export const windowBounds = (
  window: Readonly<{ start: string; end: string }>,
): readonly [number, number] => [
  Date.parse(
    DATE_ONLY.test(window.start) ? `${window.start}T00:00:00.000Z` : window.start,
  ),
  Date.parse(DATE_ONLY.test(window.end) ? `${window.end}T23:59:59.999Z` : window.end),
];

export const viewChart = (view: ViewOf<"chart.timeseries">): ViewChart | null => {
  const { points } = view.spec;
  if (points.length === 0) return null;
  const [start, end] = windowBounds(view.spec.window);
  const times = points.map((point) => Date.parse(point.at));
  // A window the points do not fit (or cannot be read) falls back to the points.
  const fits =
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start < end &&
    times.every((time) => time >= start && time <= end);
  return {
    points,
    domain: fits ? [start, end] : [Math.min(...times), Math.max(...times)],
    decimals: points.every((point) => Number.isInteger(point.value)) ? 0 : 1,
  };
};

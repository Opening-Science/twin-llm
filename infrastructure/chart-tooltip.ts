/**
 * Where a chart tooltip goes. Pure, shared by the Data page charts and the
 * wearables chart.
 */

export type Size = Readonly<{ width: number; height: number }>;

/** Gap between the hovered point and the tooltip, in CSS pixels. */
const TOOLTIP_GAP = 12;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

/**
 * The tooltip's top-left corner for a hovered point: right of the point if it
 * fits, else left of it, else pinned inside the chart; vertically centred on
 * the point and kept inside the chart.
 */
export const tooltipPosition = (
  point: Readonly<{ x: number; y: number }>,
  chart: Size,
  tip: Size,
): Readonly<{ left: number; top: number }> => {
  const right = point.x + TOOLTIP_GAP;
  const left = point.x - TOOLTIP_GAP - tip.width;
  const x =
    right + tip.width <= chart.width
      ? right
      : left >= 0
        ? left
        : clamp(right, 0, chart.width - tip.width);
  return { left: x, top: clamp(point.y - tip.height / 2, 0, chart.height - tip.height) };
};

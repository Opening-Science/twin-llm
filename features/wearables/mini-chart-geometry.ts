/**
 * Geometry for the small charts on dashboard cards: a trend line and a row
 * of bars. Pure numbers in a viewBox; the components only draw them.
 */

export type MiniBox = Readonly<{ width: number; height: number; pad: number }>;

/** Rounded for the path string only; this is geometry, not display text. */
const coord = (value: number): string => String(Math.round(value * 10) / 10);

/**
 * An SVG path through the values, scaled to fill the box between its
 * lowest and highest value. Fewer than two finite values draw nothing.
 */
export const trendPath = (values: readonly number[], box: MiniBox): string => {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length < 2) return "";
  const min = Math.min(...finite);
  const span = Math.max(...finite) - min;
  const innerW = box.width - box.pad * 2;
  const innerH = box.height - box.pad * 2;
  return finite
    .map((value, index) => {
      const x = box.pad + (index / (finite.length - 1)) * innerW;
      // A flat series sits in the middle rather than on the floor.
      const share = span === 0 ? 0.5 : (value - min) / span;
      const y = box.pad + innerH - share * innerH;
      return `${index === 0 ? "M" : "L"}${coord(x)},${coord(y)}`;
    })
    .join(" ");
};

export type Bar = Readonly<{ x: number; y: number; width: number; height: number }>;

/**
 * Bars from zero up to each value, scaled to the largest. A missing or
 * negative value draws no bar but keeps its slot, so days stay aligned.
 */
export const barLayout = (
  values: readonly (number | null)[],
  box: MiniBox,
  gap = 2,
): readonly (Bar | null)[] => {
  if (values.length === 0) return [];
  const finite = values.filter(
    (value): value is number => value !== null && Number.isFinite(value) && value > 0,
  );
  const max = finite.length === 0 ? 0 : Math.max(...finite);
  const innerW = box.width - box.pad * 2;
  const innerH = box.height - box.pad * 2;
  const slot = innerW / values.length;
  const width = Math.max(1, slot - gap);
  return values.map((value, index) => {
    if (value === null || !Number.isFinite(value) || value <= 0 || max === 0) {
      return null;
    }
    const height = (value / max) * innerH;
    return {
      x: box.pad + index * slot + (slot - width) / 2,
      y: box.pad + innerH - height,
      width,
      height,
    };
  });
};

/** The last `count` items, oldest first. */
export const lastItems = <T>(items: readonly T[], count: number): readonly T[] =>
  count <= 0 ? [] : items.slice(-count);

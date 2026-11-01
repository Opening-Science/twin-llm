/**
 * The map's sequential colour scale. Values fall into bins by quantile (as
 * GBD Compare's maps do), so each colour covers about as many places; with
 * few distinct values there are fewer bins. Colours are steps from the
 * card background to `--chart-1`, mixed by the browser in OKLCH, so the
 * same scale works in the light and the dark theme. Pure.
 */

export const DEFAULT_BINS = 5;

/** The lightest step still differs from the card; the darkest is `--chart-1` itself. */
const MIN_MIX = 25;

const quantile = (sorted: readonly number[], q: number): number => {
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
};

/**
 * Upper bounds of each bin but the last, rising: `[a, b]` makes three bins
 * (≤ a, ≤ b, above). Repeated bounds are merged, so a scale over values that
 * are all equal has one bin and no bounds.
 */
export const quantileBreaks = (
  values: readonly number[],
  bins: number = DEFAULT_BINS,
): number[] => {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (sorted.length < 2 || bins < 2) return [];
  const breaks = Array.from({ length: bins - 1 }, (_, index) =>
    quantile(sorted, (index + 1) / bins),
  );
  return breaks.filter(
    (value, index) =>
      value < sorted[sorted.length - 1] && (index === 0 || value > breaks[index - 1]),
  );
};

/** The bin a value falls in: the first whose upper bound it does not pass. */
export const binIndex = (value: number, breaks: readonly number[]): number => {
  const index = breaks.findIndex((bound) => value <= bound);
  return index === -1 ? breaks.length : index;
};

/** How much `--chart-1` is mixed into the card for bin `index` of `count`, in percent. */
export const binMix = (index: number, count: number): number =>
  count <= 1 ? 100 : Math.round(MIN_MIX + ((100 - MIN_MIX) * index) / (count - 1));

/** The CSS colour of a bin. */
export const binFill = (index: number, count: number): string =>
  `color-mix(in oklch, var(--chart-1) ${binMix(index, count)}%, var(--card))`;

export type LegendBin = Readonly<{
  index: number;
  /** Lowest and highest value that falls in the bin. */
  from: number;
  to: number;
  fill: string;
}>;

/**
 * The legend's steps, from the values actually drawn: each bin runs from
 * its smallest to its largest value, so the labels never name a value that
 * no place has. Empty bins are left out.
 */
export const legendBins = (
  values: readonly number[],
  breaks: readonly number[],
): LegendBin[] => {
  const count = breaks.length + 1;
  return Array.from({ length: count }, (_, index) => {
    const inBin = values.filter(
      (value) => Number.isFinite(value) && binIndex(value, breaks) === index,
    );
    return inBin.length === 0
      ? []
      : [
          {
            index,
            from: Math.min(...inBin),
            to: Math.max(...inBin),
            fill: binFill(index, count),
          },
        ];
  }).flat();
};

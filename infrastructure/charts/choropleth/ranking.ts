/**
 * The ranked list beside the map: places by value, highest first, ties in
 * name order. Pure.
 */

export type MapRegion = Readonly<{
  /** ISO 3166-1 alpha-3 for a country, ISO 3166-2 for a state or province. */
  code: string;
  name: string;
  value: number;
  /** The 95% uncertainty interval; null where the source gives none. */
  lower: number | null;
  upper: number | null;
}>;

export const DEFAULT_TOP = 10;

export const byRank = (a: MapRegion, b: MapRegion): number =>
  b.value - a.value || a.name.localeCompare(b.name, "en");

/** Every region in rank order, each with its rank (1 is the highest value). */
export const rankRegions = (
  regions: readonly MapRegion[],
): readonly (MapRegion & Readonly<{ rank: number }>)[] =>
  regions.toSorted(byRank).map((region, index) => ({ ...region, rank: index + 1 }));

/** The first `top` of the ranking. */
export const topRegions = (regions: readonly MapRegion[], top: number = DEFAULT_TOP) =>
  rankRegions(regions).slice(0, Math.max(0, top));

/**
 * Decimals for a map's values: none from 100 up, one from 10, two below,
 * judged by the median magnitude so one outlier does not change them all.
 */
export const mapDecimals = (values: readonly number[]): number => {
  const sizes = values
    .filter(Number.isFinite)
    .map(Math.abs)
    .toSorted((a, b) => a - b);
  if (sizes.length === 0) return 0;
  const median = sizes[Math.floor((sizes.length - 1) / 2)];
  if (median >= 100) return 0;
  return median >= 10 ? 1 : 2;
};

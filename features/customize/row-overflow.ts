/**
 * Where a sideways-scrolling tab row has more tabs out of sight, and where to
 * scroll it so the open tab sits in the middle, clear of the faded edges.
 * Pure, so the component only reads the row's measures and applies these.
 */
export type RowMeasures = Readonly<{
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}>;

export type RowOverflow = Readonly<{ start: boolean; end: boolean }>;

/** One pixel of slack: zoomed layouts report fractional scroll positions. */
const SLACK = 1;

export const rowOverflow = ({
  scrollLeft,
  clientWidth,
  scrollWidth,
}: RowMeasures): RowOverflow => ({
  start: scrollLeft > SLACK,
  end: scrollLeft + clientWidth < scrollWidth - SLACK,
});

/** The scroll position that centres a tab in its row (clamped by the browser at the end). */
export const centredScrollLeft = (
  tabLeft: number,
  tabWidth: number,
  rowWidth: number,
): number => Math.max(0, tabLeft - (rowWidth - tabWidth) / 2);

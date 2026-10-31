/**
 * The layout arithmetic behind `BentoGrid`, kept pure so it is tested
 * without a browser. The grid measures its own width (not the window's),
 * picks a column count here, and clamps every card's span to it.
 *
 * Thresholds: a card should never be narrower than about 200px. Four
 * columns with three 12px gaps need 4 × 200 + 36 = 836px, so four columns
 * start at 840px. Two columns start at 480px (two cards of 234px). Below
 * that the grid is one column and spans are ignored.
 */

export type BentoColumns = 1 | 2 | 4;

export const BENTO_FOUR_COLUMNS_FROM = 840;
export const BENTO_TWO_COLUMNS_FROM = 480;

/** The gap between cards and the smallest row height, in CSS pixels. */
export const BENTO_GAP = 12;
export const BENTO_MIN_ROW = 200;

export type BentoSpan = Readonly<{ cols: number; rows: number }>;

/** Columns for a measured container width; a missing or bad width gives one. */
export const columnsForWidth = (width: number): BentoColumns => {
  if (!Number.isFinite(width)) return 1;
  if (width >= BENTO_FOUR_COLUMNS_FROM) return 4;
  if (width >= BENTO_TWO_COLUMNS_FROM) return 2;
  return 1;
};

const wholeAtLeastOne = (value: number): number =>
  Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;

/**
 * The span a card actually takes. Columns are clamped to the grid, so a
 * span of 3 on two columns fills the row instead of adding a phantom
 * column. On one column every card is one cell: no spans at all.
 */
export const effectiveSpan = (span: BentoSpan, columns: BentoColumns): BentoSpan => {
  if (columns === 1) return { cols: 1, rows: 1 };
  return {
    cols: Math.min(wholeAtLeastOne(span.cols), columns),
    rows: wholeAtLeastOne(span.rows),
  };
};

/** Step between cards rising in, and the card after which they stop waiting. */
export const BENTO_REVEAL_STEP_MS = 70;
export const BENTO_REVEAL_MAX_STEPS = 8;

/** When a card starts to rise in; a long grid does not keep the last one waiting. */
export const revealDelayMs = (index: number): number =>
  Math.min(Math.max(0, Math.floor(index)), BENTO_REVEAL_MAX_STEPS) * BENTO_REVEAL_STEP_MS;

export type Point = Readonly<{ x: number; y: number }>;
export type Size = Readonly<{ width: number; height: number }>;

/**
 * Distance from a click to the farthest corner of the grid: the radius a
 * ring needs to have crossed the whole grid when it fades out.
 */
export const farthestCornerDistance = (point: Point, size: Size): number => {
  const dx = Math.max(point.x, size.width - point.x);
  const dy = Math.max(point.y, size.height - point.y);
  return Math.hypot(dx, dy);
};

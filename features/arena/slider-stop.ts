/**
 * Where a stop's label goes under a native range input. The thumb's centre
 * runs from half a thumb in from the left edge to half a thumb in from the
 * right, so a label at plain `index / (count - 1)` drifts off its stop
 * towards the ends. The thumb width is the browsers' default for an
 * unstyled range input.
 */

export const RANGE_THUMB_PX = 16;

/** CSS `left` for the centre of stop `index` of `count`. */
export const sliderStopLeft = (index: number, count: number): string => {
  const share = count <= 1 ? 0 : index / (count - 1);
  const px = (0.5 - share) * RANGE_THUMB_PX;
  return `calc(${String(share * 100)}% + ${String(px)}px)`;
};

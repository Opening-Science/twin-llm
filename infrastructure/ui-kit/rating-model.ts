/**
 * Keys for a 1 to `max` rating, as a radio group handles them: arrows move
 * by one and stop at the ends, Home and End jump, Backspace or Delete clears.
 * Returns the new value, null for cleared, or undefined for a key the rating
 * does not use (Tab, letters), which must then be left to the browser.
 */
export const ratingKey = (
  key: string,
  value: number | null,
  max: number,
): number | null | undefined => {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return Math.min(max, (value ?? 0) + 1);
    case "ArrowLeft":
    case "ArrowDown":
      return Math.max(1, (value ?? 1) - 1);
    case "Home":
      return 1;
    case "End":
      return max;
    case "Backspace":
    case "Delete":
      return null;
    default:
      return undefined;
  }
};

export const DEFAULT_RATING_LABELS: readonly string[] = [
  "Poor",
  "Fair",
  "Good",
  "Very good",
  "Excellent",
];

/** What the rating says beside the stars: the value and its label, or that there is none. */
export const ratingText = (value: number | null, labels: readonly string[]): string =>
  value === null
    ? "Not rated"
    : `${value} of ${labels.length}: ${labels[value - 1] ?? ""}`;

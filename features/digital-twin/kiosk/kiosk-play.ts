/**
 * Stepping through the day on the kiosk: a press goes on to the next beat,
 * and the last beat stays until something else happens. Pure, so the ends
 * are tested.
 */

export type KioskStep = "next" | "previous";

/** The beat a step lands on, or null when the day has no beats. */
export const stepKioskBeat = (
  index: number | null,
  count: number,
  step: KioskStep,
): number | null => {
  if (count === 0) return null;
  if (index === null) return 0;
  return step === "next" ? Math.min(index + 1, count - 1) : Math.max(index - 1, 0);
};

/** The step a key asks for, or null for any other key. Space and Enter are the press. */
export const kioskKeyStep = (key: string): KioskStep | null =>
  key === " " || key === "Enter" || key === "ArrowRight" || key === "ArrowDown"
    ? "next"
    : key === "ArrowLeft" || key === "ArrowUp"
      ? "previous"
      : null;

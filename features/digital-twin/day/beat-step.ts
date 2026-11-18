/**
 * Stepping through a day's beats one at a time, as a story is told: the next
 * or previous beat, the first or last. Pure, so the ends are tested; it stops
 * at the ends rather than wrapping, so "next" never jumps back to the morning.
 */

export type BeatStep = "next" | "previous" | "first" | "last";

/** The beat a step lands on, or null when the day has none. */
export const stepBeat = (
  selected: number | null,
  count: number,
  step: BeatStep,
): number | null => {
  if (count === 0) return null;
  const last = count - 1;
  if (step === "first") return 0;
  if (step === "last") return last;
  if (selected === null) return step === "next" ? 0 : last;
  return step === "next" ? Math.min(selected + 1, last) : Math.max(selected - 1, 0);
};

/** The step a key asks for on the list of beats, or null for any other key. */
export const keyStep = (key: string): BeatStep | null =>
  key === "ArrowDown" || key === "ArrowRight"
    ? "next"
    : key === "ArrowUp" || key === "ArrowLeft"
      ? "previous"
      : key === "Home"
        ? "first"
        : key === "End"
          ? "last"
          : null;

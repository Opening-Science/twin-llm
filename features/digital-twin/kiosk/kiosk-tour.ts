import { type KioskDay } from "@/packages/query-tools/kiosk-day";

/**
 * The attract loop's tour: while nobody is at the screen, the twin lights
 * the places the day will visit, one after another, so a passer-by sees
 * what the day is about before pressing. Pure, so the order is tested.
 */

/** How long the tour stays on one place. */
export const TOUR_STEP_MS = 8000;

/** The first beat of each place the day turns to, in the day's order. */
export const kioskTourStops = (day: KioskDay): readonly number[] =>
  day.beats.reduce<readonly number[]>(
    (stops, beat, index) =>
      stops.some((stop) => day.beats[stop]?.view.focus === beat.view.focus)
        ? stops
        : [...stops, index],
    [],
  );

/** The beat the tour shows at a step, going round; null for a day without beats. */
export const tourBeat = (stops: readonly number[], step: number): number | null =>
  stops.length === 0 ? null : (stops[step % stops.length] ?? null);

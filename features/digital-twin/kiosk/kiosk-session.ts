/**
 * The kiosk's session, as a reducer over presses and clock ticks. Pure, so
 * every path back to the attract loop is tested.
 *
 * - `attract`: nobody is at the screen. The twin turns and the screen asks
 *   for a press.
 * - `day`: someone pressed. The day plays beat by beat, a press going on.
 *
 * A press on the last beat ends the day, and so does a stretch with no press
 * (`IDLE_RESET_MS`). Either way the session goes back to exactly
 * `ATTRACT`, the value it started from: nothing of the visit is kept.
 */

export type KioskSession =
  | Readonly<{ phase: "attract" }>
  | Readonly<{ phase: "day"; beat: number; lastPressMs: number }>;

export type KioskEvent =
  | Readonly<{ type: "press"; nowMs: number }>
  | Readonly<{ type: "back"; nowMs: number }>
  | Readonly<{ type: "tick"; nowMs: number }>;

export const ATTRACT: KioskSession = Object.freeze({ phase: "attract" });

/** No press for this long and the kiosk goes back to the attract loop. */
export const IDLE_RESET_MS = 60_000;

export const kioskSession = (
  session: KioskSession,
  event: KioskEvent,
  beatCount: number,
): KioskSession => {
  if (session.phase === "attract") {
    // A day without beats has nothing to play, so a press leaves the loop running.
    return event.type === "press" && beatCount > 0
      ? { phase: "day", beat: 0, lastPressMs: event.nowMs }
      : session;
  }
  switch (event.type) {
    case "press":
      return session.beat >= beatCount - 1
        ? ATTRACT
        : { phase: "day", beat: session.beat + 1, lastPressMs: event.nowMs };
    case "back":
      return {
        phase: "day",
        beat: Math.max(session.beat - 1, 0),
        lastPressMs: event.nowMs,
      };
    case "tick":
      return event.nowMs - session.lastPressMs >= IDLE_RESET_MS ? ATTRACT : session;
  }
};

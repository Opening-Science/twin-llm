import { IDLE_RESET_MS, type KioskSession } from "./kiosk-session";

/**
 * The line under a playing beat that tells the visitor what a press does and,
 * near the end of the idle time, that the kiosk is about to go back to the
 * start. Pure, so the wording at each moment is tested.
 */

/** In the last stretch of the idle time the hint counts down. */
export const COUNTDOWN_FROM_MS = 10_000;

export type KioskHint =
  | Readonly<{ kind: "next" }>
  | Readonly<{ kind: "last" }>
  | Readonly<{ kind: "leaving"; seconds: number }>;

export const kioskHint = (
  session: KioskSession,
  beatCount: number,
  nowMs: number,
): KioskHint | null => {
  if (session.phase !== "day") return null;
  const left = IDLE_RESET_MS - (nowMs - session.lastPressMs);
  if (left <= COUNTDOWN_FROM_MS) {
    return { kind: "leaving", seconds: Math.max(1, Math.ceil(left / 1000)) };
  }
  return session.beat >= beatCount - 1 ? { kind: "last" } : { kind: "next" };
};

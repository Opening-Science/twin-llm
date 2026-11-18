import { describe, expect, test } from "bun:test";

import {
  ATTRACT,
  IDLE_RESET_MS,
  type KioskEvent,
  type KioskSession,
  kioskSession,
} from "./kiosk-session";

const run = (events: readonly KioskEvent[], beats = 3): KioskSession =>
  events.reduce((session, event) => kioskSession(session, event, beats), ATTRACT);

const press = (nowMs: number): KioskEvent => ({ type: "press", nowMs });
const tick = (nowMs: number): KioskEvent => ({ type: "tick", nowMs });

describe("kioskSession", () => {
  test("waits in the attract loop until a press", () => {
    expect(run([tick(0), tick(IDLE_RESET_MS * 3)])).toBe(ATTRACT);
    expect(run([{ type: "back", nowMs: 5 }])).toBe(ATTRACT);
  });

  test("a press starts the day on its first beat", () => {
    expect(run([press(1000)])).toEqual({ phase: "day", beat: 0, lastPressMs: 1000 });
  });

  test("each press goes on one beat; back goes back and stops at the first", () => {
    expect(run([press(0), press(10), press(20)])).toEqual({
      phase: "day",
      beat: 2,
      lastPressMs: 20,
    });
    expect(
      run([
        press(0),
        press(10),
        { type: "back", nowMs: 20 },
        { type: "back", nowMs: 30 },
      ]),
    ).toEqual({
      phase: "day",
      beat: 0,
      lastPressMs: 30,
    });
  });

  test("a press on the last beat ends the day", () => {
    expect(run([press(0), press(1), press(2), press(3)])).toBe(ATTRACT);
  });

  test("no press for the idle time goes back to the attract loop, one tick sooner does not", () => {
    expect(run([press(0), tick(IDLE_RESET_MS - 1)])).toEqual({
      phase: "day",
      beat: 0,
      lastPressMs: 0,
    });
    expect(run([press(0), tick(IDLE_RESET_MS)])).toBe(ATTRACT);
  });

  test("a press keeps the visit going from that moment", () => {
    expect(run([press(0), press(IDLE_RESET_MS - 1), tick(IDLE_RESET_MS + 10)])).toEqual({
      phase: "day",
      beat: 1,
      lastPressMs: IDLE_RESET_MS - 1,
    });
  });

  test("every way back is the very value it started from, so nothing of the visit is kept", () => {
    const ended = run([press(0), press(1), press(2), press(3)]);
    const idled = run([press(0), press(1), tick(IDLE_RESET_MS + 1)]);
    expect([ended, idled]).toEqual([ATTRACT, ATTRACT]);
    expect(ended).toBe(ATTRACT);
    expect(idled).toBe(ATTRACT);
    expect(Object.isFrozen(ATTRACT)).toBe(true);
  });

  test("a day without beats never leaves the attract loop", () => {
    expect(run([press(0), press(1)], 0)).toBe(ATTRACT);
  });
});

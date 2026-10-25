import { describe, expect, test } from "bun:test";

import {
  AUTO_ROTATE_INTERVAL_MS,
  nextAutoRotateDelay,
  VSYNC_SLACK_MS,
} from "./frame-pacing";

/**
 * The viewer's loop: after each draw it waits the returned delay, then the
 * request draws on the next display frame. Counts draws in one second.
 */
const drawsPerSecond = (refreshHz: number): number => {
  const period = 1000 / refreshHz;
  let now = 0;
  let draws = 0;
  for (;;) {
    const wait = nextAutoRotateDelay({ lastDrawMs: now, nowMs: now, visible: true });
    if (wait === null) return draws;
    // Small epsilon: a request at exactly a frame boundary makes that frame.
    now = Math.ceil((now + wait) / period - 1e-9) * period;
    if (now > 1000 + 1e-9) return draws;
    draws += 1;
  }
};

describe("nextAutoRotateDelay", () => {
  test("waits out the 30 fps interval less half a 60 Hz frame", () => {
    expect(AUTO_ROTATE_INTERVAL_MS).toBe(1000 / 30);
    expect(VSYNC_SLACK_MS).toBe(8);
    expect(
      nextAutoRotateDelay({ lastDrawMs: 1000, nowMs: 1000, visible: true }),
    ).toBeCloseTo(1000 / 30 - 8, 9);
    expect(
      nextAutoRotateDelay({ lastDrawMs: 1000, nowMs: 1010, visible: true }),
    ).toBeCloseTo(1000 / 30 - 18, 9);
  });

  test("asks now when the frame is due within a millisecond or late", () => {
    expect(nextAutoRotateDelay({ lastDrawMs: 0, nowMs: 25, visible: true })).toBe(0);
    expect(nextAutoRotateDelay({ lastDrawMs: 0, nowMs: 500, visible: true })).toBe(0);
  });

  test("stops while the canvas is off screen", () => {
    expect(nextAutoRotateDelay({ lastDrawMs: 0, nowMs: 10, visible: false })).toBeNull();
  });

  test("draws 30 frames a second on 60 Hz and 120 Hz displays", () => {
    expect(drawsPerSecond(60)).toBe(30);
    expect(drawsPerSecond(120)).toBe(30);
  });
});

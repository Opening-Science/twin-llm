import { describe, expect, test } from "bun:test";

import {
  pausedBy,
  pauseCountdown,
  remainingAt,
  resumeCountdown,
  startCountdown,
} from "./countdown";

describe("countdown", () => {
  test("runs down from the start and never below zero", () => {
    const running = startCountdown(5000, 1000);
    expect(remainingAt(running, 1000)).toBe(5000);
    expect(remainingAt(running, 3500)).toBe(2500);
    expect(remainingAt(running, 9000)).toBe(0);
  });

  test("a pause holds the time left until it resumes", () => {
    const paused = pauseCountdown(startCountdown(5000, 0), 2000);
    expect(paused).toEqual({ remaining: 3000, since: null });
    expect(remainingAt(paused, 60_000)).toBe(3000);
    const resumed = resumeCountdown(paused, 60_000);
    expect(remainingAt(resumed, 61_000)).toBe(2000);
  });

  test("pausing twice or resuming a running one changes nothing", () => {
    const paused = pauseCountdown(startCountdown(5000, 0), 1000);
    expect(pauseCountdown(paused, 4000)).toBe(paused);
    const running = startCountdown(5000, 0);
    expect(resumeCountdown(running, 4000)).toBe(running);
  });

  test("a negative total starts at zero", () => {
    expect(startCountdown(-10, 0)).toEqual({ remaining: 0, since: 0 });
  });
});

describe("pausedBy", () => {
  test("either reason pauses", () => {
    expect(pausedBy({ hovered: false, hidden: false })).toBe(false);
    expect(pausedBy({ hovered: true, hidden: false })).toBe(true);
    expect(pausedBy({ hovered: false, hidden: true })).toBe(true);
  });
});

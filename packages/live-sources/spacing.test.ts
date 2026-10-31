import { describe, expect, test } from "bun:test";

import { createSpacing } from "./spacing";

describe("createSpacing", () => {
  test("keeps concurrent callers at least the interval apart", async () => {
    const clock = { now: 0 };
    const slept: number[] = [];
    const space = createSpacing(400, {
      now: () => clock.now,
      sleep: async (ms) => {
        slept.push(ms);
        clock.now += ms;
      },
    });
    await Promise.all([space(), space(), space()]);
    expect(slept).toEqual([400, 400]);
    expect(clock.now).toBe(800);
  });

  test("does not wait when the interval has already passed", async () => {
    const clock = { now: 0 };
    const slept: number[] = [];
    const space = createSpacing(100, {
      now: () => clock.now,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    await space();
    clock.now = 500;
    await space();
    expect(slept).toEqual([]);
  });
});

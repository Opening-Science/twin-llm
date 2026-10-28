import { describe, expect, test } from "bun:test";

import { createThrottle } from "./throttle";

const fakeClock = () => {
  const state = { now: 1000, sleeps: [] as number[] };
  return {
    state,
    clock: {
      now: () => state.now,
      sleep: async (ms: number) => {
        state.sleeps.push(ms);
        state.now += ms;
      },
    },
  };
};

describe("createThrottle", () => {
  test("the first call does not wait; later calls keep the interval", async () => {
    const { state, clock } = fakeClock();
    const throttle = createThrottle(400, clock);
    await throttle();
    state.now += 100;
    await throttle();
    await throttle();
    expect(state.sleeps).toEqual([300, 400]);
  });

  test("no wait when enough time has passed", async () => {
    const { state, clock } = fakeClock();
    const throttle = createThrottle(400, clock);
    await throttle();
    state.now += 900;
    await throttle();
    expect(state.sleeps).toEqual([]);
  });
});

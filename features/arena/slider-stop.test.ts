import { describe, expect, test } from "bun:test";

import { sliderStopLeft } from "./slider-stop";

describe("sliderStopLeft", () => {
  test("five stops sit under the thumb's centre at each step", () => {
    expect([0, 1, 2, 3, 4].map((index) => sliderStopLeft(index, 5))).toEqual([
      "calc(0% + 8px)",
      "calc(25% + 4px)",
      "calc(50% + 0px)",
      "calc(75% + -4px)",
      "calc(100% + -8px)",
    ]);
  });

  test("a single stop sits at the start", () => {
    expect(sliderStopLeft(0, 1)).toBe("calc(0% + 8px)");
  });
});

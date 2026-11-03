import { describe, expect, test } from "bun:test";

import { sliderStopLeft } from "./slider-stop";

describe("sliderStopLeft", () => {
  test("the three middle stops of five sit under the thumb's centre", () => {
    // The menu places only these three with the helper; Quick and Ultra sit on
    // the edges with `left-0` and `right-0`.
    expect([1, 2, 3].map((index) => sliderStopLeft(index, 5))).toEqual([
      "calc(25% + 4px)",
      "calc(50% + 0px)",
      "calc(75% + -4px)",
    ]);
  });
});

import { describe, expect, test } from "bun:test";

import { SIGNAL_PAD, signalLayout } from "./signal-geometry";

const BOX = { width: 416, height: 170 };
// Plot: x 8 to 408 (400 wide), y 26 to 126 (100 high).

describe("signalLayout", () => {
  const points = [
    { t: 0, value: 800 },
    { t: 5, value: 400 },
    { t: 10, value: 600 },
  ];

  test("the plot keeps the pads and the points span it, highest at the top", () => {
    const layout = signalLayout(points, 10, [], BOX);
    expect(layout.plot).toEqual({
      left: SIGNAL_PAD.left,
      top: SIGNAL_PAD.top,
      width: 400,
      height: 100,
    });
    expect(layout.xs).toEqual([8, 208, 408]);
    expect(layout.ys).toEqual([26, 126, 76]);
    expect(layout.path).toBe("M8.0,26.0 L208.0,126.0 L408.0,76.0");
  });

  test("MAX and MIN rules sit on the highest and lowest value", () => {
    const layout = signalLayout(points, 10, [], BOX);
    expect(layout.max).toEqual({ value: 800, y: 26 });
    expect(layout.min).toEqual({ value: 400, y: 126 });
  });

  test("flagged windows become bands across their seconds", () => {
    const layout = signalLayout(points, 10, [{ start: 2.5, end: 5 }], BOX);
    expect(layout.bands).toEqual([{ x: 108, width: 100 }]);
  });

  test("seconds ticks start at 0 and the last one hugs the right edge", () => {
    const layout = signalLayout(points, 10, [], BOX);
    expect(layout.ticks.map((t) => [t.t, t.x, t.anchor])).toEqual([
      [0, 8, "start"],
      [2, 88, "middle"],
      [4, 168, "middle"],
      [6, 248, "middle"],
      [8, 328, "middle"],
      [10, 408, "end"],
    ]);
    expect(layout.tickDecimals).toBe(0);
  });

  test("a flat signal is drawn in the middle with MAX equal to MIN", () => {
    const layout = signalLayout(
      [
        { t: 0, value: 700 },
        { t: 1, value: 700 },
      ],
      1,
      [],
      BOX,
    );
    expect(layout.ys).toEqual([76, 76]);
    expect(layout.max).toEqual({ value: 700, y: 76 });
    expect(layout.min).toEqual({ value: 700, y: 76 });
  });
});

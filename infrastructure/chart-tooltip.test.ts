import { describe, expect, test } from "bun:test";

import { tooltipPosition } from "./chart-tooltip";

describe("tooltipPosition", () => {
  const chart = { width: 400, height: 200 };
  const tip = { width: 120, height: 40 };

  test("sits right of the point when it fits", () => {
    expect(tooltipPosition({ x: 100, y: 100 }, chart, tip)).toEqual({
      left: 112,
      top: 80,
    });
  });

  test("flips left near the right edge and stays inside vertically", () => {
    expect(tooltipPosition({ x: 350, y: 5 }, chart, tip)).toEqual({ left: 218, top: 0 });
  });

  test("a tooltip too wide for either side is pinned inside the chart", () => {
    expect(tooltipPosition({ x: 100, y: 190 }, { width: 200, height: 200 }, tip)).toEqual(
      {
        left: 80,
        top: 160,
      },
    );
  });
});

describe("tooltipPosition on a wearables-sized chart", () => {
  const tip = { width: 150, height: 60 };

  test("right of the point when it fits, left of it when it does not", () => {
    const chart = { width: 800, height: 225 };
    expect(tooltipPosition({ x: 100, y: 100 }, chart, tip)).toEqual({
      left: 112,
      top: 70,
    });
    expect(tooltipPosition({ x: 700, y: 100 }, chart, tip)).toEqual({
      left: 538,
      top: 70,
    });
  });

  test("held inside the chart at the top and bottom edges", () => {
    const chart = { width: 800, height: 225 };
    expect(tooltipPosition({ x: 100, y: 5 }, chart, tip).top).toBe(0);
    expect(tooltipPosition({ x: 100, y: 220 }, chart, tip).top).toBe(165);
  });

  test("a narrow chart never pushes the tooltip past either edge", () => {
    // 375 px phone: the chart is about 300 px wide.
    const chart = { width: 300, height: 84 };
    // Fits on neither side of a centre point: pinned to the right edge.
    expect(tooltipPosition({ x: 150, y: 40 }, chart, { width: 200, height: 60 })).toEqual(
      {
        left: 100,
        top: 10,
      },
    );
    // Wider than the chart (it wraps at max-width): starts at 0.
    expect(
      tooltipPosition({ x: 150, y: 40 }, chart, { width: 320, height: 100 }),
    ).toEqual({
      left: 0,
      top: 0,
    });
  });
});

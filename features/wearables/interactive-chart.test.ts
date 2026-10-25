import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { InteractiveChart, tooltipPosition, type ChartSeries } from "./interactive-chart";

// Synthetic fixture points, not anyone's data.
const series: readonly ChartSeries[] = [
  {
    id: "a",
    label: "Fixture A",
    points: [
      { date: "2026-01-01", value: 70 },
      { date: "2026-01-02", value: 74 },
    ],
  },
  {
    id: "b",
    label: "Fixture B",
    points: [
      { date: "2026-01-01", value: 60 },
      { date: "2026-01-02", value: 66 },
    ],
  },
];

const render = (s: readonly ChartSeries[]) =>
  renderToStaticMarkup(createElement(InteractiveChart, { series: s }));

describe("InteractiveChart colours", () => {
  test("series take chart tokens in order, never the interactive accent", () => {
    const html = render(series);
    expect(html.match(/<g class="text-chart-1">/g)?.length).toBe(1);
    expect(html.match(/<g class="text-chart-2">/g)?.length).toBe(1);
    expect(html).not.toContain("text-primary");
  });

  test("the legend names each series beside a swatch in its colour", () => {
    const html = render(series);
    expect(html).toContain(
      '<span class="size-2 rounded-full bg-current text-chart-1" aria-hidden="true"></span>Fixture A</li>',
    );
    expect(html).toContain(
      '<span class="size-2 rounded-full bg-current text-chart-2" aria-hidden="true"></span>Fixture B</li>',
    );
  });

  test("an explicit series class still wins", () => {
    const html = render([{ ...series[0]!, className: "text-chart-4" }]);
    expect(html).toContain('<g class="text-chart-4">');
    expect(html).not.toContain("text-chart-1");
  });
});

describe("InteractiveChart y-axis", () => {
  test("a five-digit tick fits left of the plot", () => {
    const html = render([
      {
        id: "steps",
        label: "Fixture steps",
        points: [
          { date: "2026-01-01", value: 5345 },
          { date: "2026-01-02", value: 10635 },
        ],
      },
    ]);
    // Y ticks are the end-anchored labels that are numbers, not dates.
    const ticks = [
      ...html.matchAll(/<text x="([\d.]+)"[^>]*text-anchor="end"[^>]*>([\d,]+)<\/text>/g),
    ];
    expect(ticks.map((tick) => [tick[1], tick[2]])).toEqual([
      ["40", "5,345"],
      ["40", "7,990"],
      ["40", "10,635"],
    ]);
    // 10px mono runs about 6px a character; the label must end inside x >= 0.
    expect(Number(ticks[2]![1]) - "10,635".length * 6).toBeGreaterThanOrEqual(0);
  });
});

describe("tooltipPosition", () => {
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

describe("InteractiveChart label", () => {
  test("names its series", () => {
    expect(render(series)).toContain('aria-label="Timeline of Fixture A and Fixture B"');
  });
});

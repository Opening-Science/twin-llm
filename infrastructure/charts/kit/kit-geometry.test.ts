import { describe, expect, test } from "bun:test";

import {
  barsWithLine,
  cumulativeDay,
  edgeAnchor,
  estimateLayout,
  estimateRows,
  exactDecimals,
  hypnogram,
  log2Ticks,
  monthShares,
  nullBand,
  nullFigure,
  radar,
  radarAxisAt,
  rangeBars,
  ringPartAt,
  scoreRing,
  slotIndex,
  spacedTicks,
  stepKey,
  weekStep,
  streakGrid,
  weekdayLetters,
} from "./kit-geometry";

const box = { width: 280, height: 100 };

describe("cumulative day", () => {
  const average = [
    { at: 0, value: 0 },
    { at: 0.5, value: 4000 },
    { at: 1, value: 8000 },
  ];

  test("splits the reference at now, and both halves meet there", () => {
    const day = cumulativeDay([], average, 0.25, box);
    expect(day.averagePast).toBe("M0,100 L70,75");
    expect(day.averageFuture).toBe("M70,75 L140,50 L280,0");
    expect(day.nowX).toBe(70);
  });

  test("today ends in a dot at its last sample before now", () => {
    const today = [
      { at: 0, value: 0 },
      { at: 0.25, value: 1000 },
      { at: 0.5, value: 3000 },
    ];
    const day = cumulativeDay(today, average, 0.5, box);
    expect(day.today).toBe("M0,100 L70,87.5 L140,62.5");
    expect(day.now).toEqual({ x: 140, y: 62.5 });
  });

  test("no future at the end of the day, no line from one sample", () => {
    const day = cumulativeDay([{ at: 0.1, value: 5 }], average, 1, box);
    expect(day.averageFuture).toBe("");
    expect(day.today).toBe("");
    expect(day.now).not.toBeNull();
  });
});

describe("bars with a line", () => {
  test("bars and the average share one scale", () => {
    const out = barsWithLine([50, 100, null], 200, { width: 300, height: 100 });
    expect(out.lineY).toBe(0);
    expect(out.bars[0]).toEqual({ x: 36, y: 75, width: 28, height: 25 });
    expect(out.bars[2]).toBeNull();
    expect(out.centres).toEqual([50, 150, 250]);
  });

  test("narrow slots give narrow bars, and no line without a reference", () => {
    const out = barsWithLine(
      Array.from({ length: 14 }, () => 1),
      null,
      box,
    );
    expect(out.bars[0]!.width).toBe(14);
    expect(out.lineY).toBeNull();
  });

  test("nothing to draw when every value is missing or zero", () => {
    const out = barsWithLine([0, null], null, box);
    expect(out.bars).toEqual([null, null]);
  });
});

describe("streak grid", () => {
  test("starts on the week start and labels each month once", () => {
    // 30 Oct 2026 is a Friday.
    const days = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"].map((date) => ({
      date,
      done: date !== "2026-10-31",
    }));
    const cells = streakGrid(days, "2026-11-02", 1);
    expect(cells.map((c) => [c.row, c.col])).toEqual([
      [0, 4],
      [0, 5],
      [0, 6],
      [1, 0],
    ]);
    expect(cells.map((c) => c.month)).toEqual(["OCT", null, "NOV", null]);
    expect(cells.find((c) => c.today)?.day).toBe(2);
    expect(cells[1]!.done).toBe(false);
  });

  test("a Sunday start moves the columns", () => {
    expect(streakGrid([{ date: "2026-11-01", done: true }], "x", 0)[0]!.col).toBe(0);
    expect(weekdayLetters(0).join("")).toBe("SMTWTFS");
    expect(weekdayLetters(1).join("")).toBe("MTWTFSS");
  });

  test("no days, no cells", () => {
    expect(streakGrid([], "2026-11-01")).toEqual([]);
  });
});

describe("range bars", () => {
  test("find the extremes and span them", () => {
    const out = rangeBars([{ min: 60, max: 80 }, null, { min: 50, max: 100 }], box);
    expect(out.lowest).toBe(2);
    expect(out.highest).toBe(2);
    expect([out.min, out.max]).toEqual([50, 100]);
    expect(out.bars[1]).toBeNull();
    expect(out.bars[2]!.height).toBe(100);
    expect(out.bars[0]!.y).toBe(40);
  });

  test("a flat bucket is still a pill", () => {
    const out = rangeBars(
      [
        { min: 70, max: 70 },
        { min: 60, max: 90 },
      ],
      box,
    );
    expect(out.bars[0]!.height).toBe(out.bars[0]!.width);
  });

  test("all missing draws nothing", () => {
    expect(rangeBars([null, null], box).lowest).toBe(-1);
  });
});

describe("hypnogram", () => {
  const spans = [
    { stage: "core", start: 0, end: 60 },
    { stage: "deep", start: 60, end: 90 },
    { stage: "rem", start: 90, end: 120 },
  ] as const;

  test("totals each stage and spans the night", () => {
    const out = hypnogram(spans, { width: 120, height: 100 }, 0);
    expect(out.minutes).toEqual({ awake: 0, rem: 30, core: 60, deep: 30 });
    expect(out.blocks.map((b) => [b.stage, b.x, b.width])).toEqual([
      ["core", 0, 60],
      ["deep", 60, 30],
      ["rem", 90, 30],
    ]);
    expect(out.laneY).toEqual({ awake: 0, rem: 25, core: 50, deep: 75 });
  });

  test("steps join one stage to the next", () => {
    const out = hypnogram(spans, { width: 120, height: 100 }, 0);
    expect(out.steps).toBe("M60,62.5 L60,87.5 M90,87.5 L90,37.5");
  });

  test("empty and backwards spans are left out", () => {
    const out = hypnogram([{ stage: "awake", start: 5, end: 5 }], box);
    expect(out.blocks).toEqual([]);
    expect(out.minutes.awake).toBe(0);
  });
});

describe("score ring", () => {
  test("scores the parts as a share of their maximum", () => {
    const ring = scoreRing(
      [
        { value: 50, max: 50 },
        { value: 15, max: 30 },
        { value: 20, max: 20 },
      ],
      120,
    );
    expect(ring.score).toBe(85);
    expect(ring.arcs).toHaveLength(3);
    expect(ring.arcs.every((a) => a.track.startsWith("M"))).toBe(true);
  });

  test("an empty part has a track and no value arc", () => {
    const ring = scoreRing(
      [
        { value: 0, max: 10 },
        { value: 10, max: 10 },
      ],
      120,
    );
    expect(ring.arcs[0]!.track).not.toBe("");
    expect(ring.arcs[0]!.value).toBe("");
  });

  test("no maximum, no score", () => {
    expect(scoreRing([{ value: 3, max: 0 }], 120).score).toBe(0);
  });
});

describe("month shares", () => {
  test("scale to the larger month", () => {
    expect(monthShares(439, 402)).toEqual({ current: 1, previous: 402 / 439 });
    expect(monthShares(null, 10)).toEqual({ current: 0, previous: 1 });
    expect(monthShares(null, null)).toEqual({ current: 0, previous: 0 });
  });
});

describe("estimate rows", () => {
  test("one shared axis covers every interval and the reference", () => {
    const out = estimateRows(
      [
        { label: "within person", estimate: 3.09, low: 2.07, high: 4.63 },
        { label: "shuffled", estimate: 1.02, low: 0.8, high: 1.3 },
      ],
      { width: 500, height: 80 },
      1,
    );
    expect(out.ticks[0]!.value).toBeLessThanOrEqual(0.8);
    expect(out.ticks.at(-1)!.value).toBeGreaterThanOrEqual(4.63);
    expect(out.rows.map((r) => r.y)).toEqual([20, 60]);
    expect(out.rows[0]!.low!).toBeLessThan(out.rows[0]!.x);
    expect(out.referenceX).not.toBeNull();
  });

  test("a fixed domain, such as 0 to 1 for a proportion", () => {
    const out = estimateRows(
      [{ label: "AFDB", estimate: 0.954 }],
      { width: 100, height: 20 },
      null,
      [0, 1],
    );
    expect(out.rows[0]!.x).toBeCloseTo(95.4);
    expect(out.rows[0]!.low).toBeNull();
    expect(out.ticks.map((t) => t.x)).toContain(100);
  });
});

describe("null figure", () => {
  test("places the observed value and the share at or above it", () => {
    const draws = Array.from({ length: 100 }, (_, i) => i / 100);
    const out = nullFigure(draws, 0.9, { width: 100, height: 50 }, 10);
    expect(out.bars).toHaveLength(10);
    expect(out.atOrBeyond).toBeCloseTo(0.1);
    expect(out.observedX).toBeCloseTo((0.9 / 0.99) * 100);
  });

  test("an observed value past every draw sits at the right edge", () => {
    const out = nullFigure([1, 2, 3], 10, { width: 100, height: 50 }, 4);
    expect(out.observedX).toBe(100);
    expect(out.atOrBeyond).toBe(0);
  });

  test("no draws, no bars", () => {
    expect(nullFigure([], 1, box).bars).toEqual([]);
  });
});

describe("exact decimals", () => {
  test("write every tick exactly", () => {
    expect(exactDecimals([0, 0.25, 0.5, 0.75, 1])).toBe(2);
    expect(exactDecimals([1, 2, 3])).toBe(0);
    expect(exactDecimals([0.1, 0.2])).toBe(1);
    expect(exactDecimals([1 / 3])).toBe(4);
  });
});

describe("radar", () => {
  const axis = (value: number | null, max = 10, reference: number | null = null) => ({
    label: "x",
    value,
    display: "",
    reference,
    max,
  });
  const square = { width: 200, height: 200 };
  const room = { x: 0, y: 0 };

  test.each([3, 4, 5, 8])("%i axes give that many vertices, first at the top", (n) => {
    const out = radar(
      Array.from({ length: n }, () => axis(10)),
      square,
      room,
    );
    expect(out.points).toHaveLength(n);
    expect(out.spokes).toHaveLength(n);
    expect(out.anchors).toHaveLength(n);
    expect(out.rings).toHaveLength(3);
    expect(out.points[0]!.x).toBeCloseTo(100);
    expect(out.points[0]!.y).toBeCloseTo(0);
    expect(out.anchors[0]).toMatchObject({ align: "middle", above: true });
  });

  test("each axis is its own scale", () => {
    const out = radar([axis(5, 10), axis(50, 100), axis(1, 2)], square, room);
    const distance = (p: { x: number; y: number }) => Math.hypot(p.x - 100, p.y - 100);
    for (const p of out.points) expect(distance(p)).toBeCloseTo(50);
  });

  test("a value above its maximum stops at the rim", () => {
    const out = radar([axis(30), axis(10), axis(10), axis(10)], square, room);
    expect(out.points[0]).toEqual({ x: 100, y: 0 });
  });

  test("a missing value sits at the centre", () => {
    const out = radar([axis(null), axis(10), axis(10)], square, room);
    expect(out.points[0]).toEqual({ x: 100, y: 100 });
  });

  test("the reference is drawn only when an axis has one", () => {
    expect(radar([axis(5), axis(5), axis(5)], square, room).reference).toBe("");
    expect(radar([axis(5, 10, 8), axis(5), axis(5)], square, room).reference).toMatch(
      /Z$/,
    );
  });

  test("the chart shrinks to leave room for its labels", () => {
    const wide = radar([axis(1), axis(1), axis(1)], { width: 600, height: 300 });
    const narrow = radar([axis(1), axis(1), axis(1)], { width: 300, height: 300 });
    expect(narrow.radius).toBeLessThan(wide.radius);
    expect(narrow.radius).toBe((300 - 2 * 84) / 2);
    expect(narrow.anchors[1]!.align).toBe("start");
    expect(narrow.anchors[2]!.align).toBe("end");
  });

  test("fewer than three axes draw nothing", () => {
    expect(radar([axis(1), axis(1)], square).value).toBe("");
  });
});

describe("estimate layout", () => {
  test("labels sit beside a wide plot and above a narrow one", () => {
    expect(estimateLayout(560)).toEqual({
      stacked: false,
      left: 176,
      plot: 372,
      row: 32,
    });
    const narrow = estimateLayout(273);
    expect(narrow.stacked).toBe(true);
    expect(narrow.plot).toBe(249);
    expect(narrow.row).toBeGreaterThan(32);
  });

  test("ticks thin out until they have room", () => {
    const ticks = [0, 1, 2, 3, 4].map((i) => ({ x: i * 20, value: i }));
    expect(spacedTicks(ticks).map((t) => t.value)).toEqual([0, 2, 4]);
    expect(spacedTicks(ticks, 10)).toHaveLength(5);
    expect(spacedTicks(ticks.slice(0, 2))).toHaveLength(2);
  });
});

describe("edge anchor", () => {
  test("a label near an edge grows inward", () => {
    expect(edgeAnchor(0, 300)).toBe("start");
    expect(edgeAnchor(47, 300)).toBe("start");
    expect(edgeAnchor(150, 300)).toBe("middle");
    expect(edgeAnchor(260, 300)).toBe("end");
    expect(edgeAnchor(300, 300)).toBe("end");
  });

  test("the margin is adjustable", () => {
    expect(edgeAnchor(60, 300, 80)).toBe("start");
    expect(edgeAnchor(60, 300, 40)).toBe("middle");
  });
});

describe("step key", () => {
  test("arrows step and stop at the ends", () => {
    expect(stepKey("ArrowRight", 2, 7)).toEqual({ kind: "move", index: 3 });
    expect(stepKey("ArrowRight", 6, 7)).toEqual({ kind: "move", index: 6 });
    expect(stepKey("ArrowLeft", 0, 7)).toEqual({ kind: "move", index: 0 });
  });

  test("from no focus, next is the first point and previous the last", () => {
    expect(stepKey("ArrowRight", null, 7)).toEqual({ kind: "move", index: 0 });
    expect(stepKey("ArrowLeft", null, 7)).toEqual({ kind: "move", index: 6 });
  });

  test("Home and End jump, Escape clears only a focus", () => {
    expect(stepKey("Home", 4, 7)).toEqual({ kind: "move", index: 0 });
    expect(stepKey("End", null, 7)).toEqual({ kind: "move", index: 6 });
    expect(stepKey("Escape", 3, 7)).toEqual({ kind: "clear" });
    expect(stepKey("Escape", null, 7)).toEqual({ kind: "ignore" });
  });

  test("the axis decides which arrows step", () => {
    expect(stepKey("ArrowDown", 1, 4)).toEqual({ kind: "ignore" });
    expect(stepKey("ArrowDown", 1, 4, "y")).toEqual({ kind: "move", index: 2 });
    expect(stepKey("ArrowUp", 1, 4, "both")).toEqual({ kind: "move", index: 0 });
    expect(stepKey("ArrowRight", 1, 4, "y")).toEqual({ kind: "ignore" });
  });

  test("other keys and empty charts are ignored", () => {
    expect(stepKey("a", 1, 4)).toEqual({ kind: "ignore" });
    expect(stepKey("ArrowRight", null, 0)).toEqual({ kind: "ignore" });
  });
});

describe("slot index", () => {
  test("the slot under a pointer", () => {
    expect(slotIndex(0, 280, 7)).toBe(0);
    expect(slotIndex(139, 280, 7)).toBe(3);
    expect(slotIndex(280, 280, 7)).toBe(6);
  });

  test("outside the chart, nothing", () => {
    expect(slotIndex(-1, 280, 7)).toBeNull();
    expect(slotIndex(281, 280, 7)).toBeNull();
    expect(slotIndex(10, 280, 0)).toBeNull();
  });
});

describe("radar axis at", () => {
  test("the nearest axis clockwise from the top", () => {
    expect(radarAxisAt(0, -50, 4)).toBe(0);
    expect(radarAxisAt(50, 0, 4)).toBe(1);
    expect(radarAxisAt(0, 50, 4)).toBe(2);
    expect(radarAxisAt(-50, 0, 4)).toBe(3);
    expect(radarAxisAt(-10, -50, 4)).toBe(0);
  });

  test("a triangle and an octagon", () => {
    expect(radarAxisAt(40, 25, 3)).toBe(1);
    expect(radarAxisAt(-40, 25, 3)).toBe(2);
    expect(radarAxisAt(35, -35, 8)).toBe(1);
  });

  test("no direction at the centre", () => {
    expect(radarAxisAt(1, 1, 5)).toBeNull();
  });
});

describe("ring part at", () => {
  const parts = [
    { value: 1, max: 50 },
    { value: 1, max: 30 },
    { value: 1, max: 20 },
  ];

  test("each part covers its share, clockwise from the top", () => {
    expect(ringPartAt(10, -50, parts)).toBe(0);
    expect(ringPartAt(0, 50, parts)).toBe(1);
    expect(ringPartAt(-50, -30, parts)).toBe(2);
  });

  test("no part at the centre or without a maximum", () => {
    expect(ringPartAt(1, 0, parts)).toBeNull();
    expect(ringPartAt(10, 10, [{ value: 1, max: 0 }])).toBeNull();
  });
});

describe("estimate rows, extended", () => {
  const box = { width: 300, height: 60 };

  test("a log axis has even powers of two and spreads ratios near 1", () => {
    expect(log2Ticks(0.6, 7.2)).toEqual([0.5, 1, 2, 4, 8]);
    expect(log2Ticks(1, 1)).toEqual([1, 2]);
    expect(log2Ticks(0, 4)).toEqual([1]);
    const out = estimateRows(
      [
        { label: "A", estimate: 1.91, low: 1.0, high: 7.2 },
        { label: "B", estimate: 1.1 },
      ],
      box,
      1,
      undefined,
      "log",
    );
    const xs = out.ticks.map((t) => t.x);
    // Even spacing: every doubling takes the same width.
    const steps = xs.slice(1).map((x, i) => x - xs[i]!);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(1e-9);
    expect(out.referenceX).toBe(out.ticks.find((t) => t.value === 1)!.x);
  });

  test("a log axis leaves off values at or below zero", () => {
    const out = estimateRows(
      [{ label: "A", estimate: 0, low: -1, high: 2 }],
      box,
      null,
      undefined,
      "log",
    );
    expect(out.rows[0]!.low).toBeNull();
    expect(out.ticks.length).toBeGreaterThan(0);
  });

  test("padding keeps a dot at 0 off the plot's edge", () => {
    const out = estimateRows(
      [{ label: "A", estimate: 0 }],
      box,
      null,
      [0, 1],
      "linear",
      8,
    );
    expect(out.rows[0]!.x).toBe(8);
    expect(out.ticks.at(-1)!.x).toBe(292);
  });

  test("an expected value is placed on its row and widens the axis", () => {
    const out = estimateRows([{ label: "A", estimate: 1.91, expected: 3.93 }], box);
    expect(out.rows[0]!.expected).not.toBeNull();
    expect(out.ticks.at(-1)!.value).toBeGreaterThanOrEqual(3.93);
  });

  test("rows of one series share an index, in the order they first appear", () => {
    const out = estimateRows(
      [
        { label: "General 8b", estimate: 1, series: "qwen3:8b" },
        { label: "General 4b", estimate: 1, series: "qwen3:4b" },
        { label: "Heart 8b", estimate: 1, series: "qwen3:8b" },
        { label: "Other", estimate: 1 },
      ],
      box,
    );
    expect(out.series).toEqual(["qwen3:8b", "qwen3:4b"]);
    expect(out.rows.map((r) => r.series)).toEqual([0, 1, 0, null]);
  });
});

describe("null band", () => {
  test("the interval, mean and observed value on one padded axis", () => {
    const out = nullBand({ mean: 0.5, low: 0.45, high: 0.55, runs: 200 }, 0.61, {
      width: 216,
      height: 40,
    });
    expect(out.low).toBe(8);
    expect(out.observedX).toBe(208);
    expect(out.mean).toBeGreaterThan(out.low);
    expect(out.mean).toBeLessThan(out.high);
  });
});

describe("week step", () => {
  // 28 days from Monday 2 Nov 2026: four full weeks.
  const days = Array.from({ length: 28 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 10, 2 + i)).toISOString().slice(0, 10),
    done: true,
  }));
  const cells = streakGrid(days, "x", 1);

  test("down and up move a week on the same weekday", () => {
    expect(weekStep("ArrowDown", 2, cells)).toEqual({ kind: "move", index: 9 });
    expect(weekStep("ArrowUp", 9, cells)).toEqual({ kind: "move", index: 2 });
  });

  test("past the first or last week the focus stays", () => {
    expect(weekStep("ArrowUp", 2, cells)).toEqual({ kind: "move", index: 2 });
    expect(weekStep("ArrowDown", 25, cells)).toEqual({ kind: "move", index: 25 });
  });

  test("a missing day does not shift the step", () => {
    const gappy = streakGrid(
      days.filter((_, i) => i !== 4),
      "x",
      1,
    );
    // Wednesday 4 Nov (index 2) down to Wednesday 11 Nov, now index 8.
    expect(weekStep("ArrowDown", 2, gappy)).toEqual({ kind: "move", index: 8 });
    // Friday 6 Nov is missing: from Friday 13 Nov up, the focus stays.
    const friday13 = gappy.findIndex((c) => c.date === "2026-11-13");
    expect(weekStep("ArrowUp", friday13, gappy)).toEqual({
      kind: "move",
      index: friday13,
    });
  });

  test("from no focus, and other keys left to stepKey", () => {
    expect(weekStep("ArrowDown", null, cells)).toEqual({ kind: "move", index: 0 });
    expect(weekStep("ArrowUp", null, cells)).toEqual({ kind: "move", index: 27 });
    expect(weekStep("ArrowRight", 2, cells)).toBeNull();
  });
});

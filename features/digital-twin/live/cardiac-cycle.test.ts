import { describe, expect, test } from "bun:test";

import {
  advanceBeat,
  BEAT_CLOCK_START,
  beatInterval,
  beatJitter,
  cardiacStateAt,
  cardiacTiming,
  MAX_JITTER_SHARE,
} from "./cardiac-cycle";

const round = (x: number, digits = 4): number => Number(x.toFixed(digits));

describe("cardiacTiming", () => {
  test("at 60 bpm the atria take the first 15% and the ventricles the next 35%", () => {
    const timing = cardiacTiming(1);
    expect(round(timing.atrialEnd)).toBe(0.15);
    expect(round(timing.ventricularEnd)).toBe(0.5);
  });

  test("at 120 bpm systole is shorter in seconds but a larger share of the cycle", () => {
    const timing = cardiacTiming(0.5);
    expect(round(timing.atrialEnd)).toBe(0.2121);
    expect(round(timing.ventricularEnd)).toBe(0.7071);
    expect(round(timing.ventricularEnd * timing.interval)).toBe(0.3536);
  });

  test("at 40 bpm diastole takes most of the cycle", () => {
    const timing = cardiacTiming(1.5);
    expect(round(timing.atrialEnd)).toBe(0.1225);
    expect(round(timing.ventricularEnd)).toBe(0.4082);
  });

  test("at 220 bpm systole is capped at 90% of the cycle, in the same proportions", () => {
    const timing = cardiacTiming(60 / 220);
    expect(round(timing.ventricularEnd)).toBe(0.9);
    expect(round(timing.atrialEnd)).toBe(0.27);
  });
});

describe("cardiacStateAt at 60 bpm", () => {
  const timing = cardiacTiming(1);

  test("mid atrial systole: atria fully squeezed, AV valves open, semilunar shut", () => {
    expect(cardiacStateAt(0.075, timing)).toEqual({
      phase: "atrialSystole",
      atria: 1,
      ventricles: 0,
      av: 1,
      semilunar: 0,
    });
  });

  test("ejection: ventricles squeezing, AV valves shut, semilunar open", () => {
    const state = cardiacStateAt(0.4, timing);
    expect(state.phase).toBe("ventricularSystole");
    expect(state.atria).toBe(0);
    expect(round(state.ventricles)).toBe(0.968);
    expect(state.av).toBe(0);
    expect(state.semilunar).toBe(1);
  });

  test("isovolumic contraction: every valve shut", () => {
    const state = cardiacStateAt(0.17, timing);
    expect(state.av).toBe(0);
    expect(state.semilunar).toBe(0);
  });

  test("isovolumic relaxation: every valve shut, ventricles relaxing", () => {
    const state = cardiacStateAt(0.53, timing);
    expect(state.phase).toBe("diastole");
    expect(state.av).toBe(0);
    expect(state.semilunar).toBe(0);
    expect(round(state.ventricles)).toBe(0.896);
  });

  test("late diastole: everything relaxed, AV valves open", () => {
    expect(cardiacStateAt(0.9, timing)).toEqual({
      phase: "diastole",
      atria: 0,
      ventricles: 0,
      av: 1,
      semilunar: 0,
    });
  });

  test("wraps: phase 1.075 and -0.925 are the same as 0.075", () => {
    expect(cardiacStateAt(1.075, timing)).toEqual(cardiacStateAt(0.075, timing));
    expect(cardiacStateAt(-0.925, timing)).toEqual(cardiacStateAt(0.075, timing));
  });

  test("the AV and semilunar valves are never open together", () => {
    const overlap = Array.from({ length: 1000 }, (_, i) =>
      cardiacStateAt(i / 1000, timing),
    )
      .map((state) => Math.min(state.av, state.semilunar))
      .reduce((a, b) => Math.max(a, b), 0);
    expect(overlap).toBe(0);
  });
});

describe("beatInterval", () => {
  test("without HRV every beat lasts 60 / bpm", () => {
    expect([0, 1, 2].map((i) => beatInterval(i, 75, null))).toEqual([0.8, 0.8, 0.8]);
  });

  test("the jitter is fixed per beat and within [-1, 1]", () => {
    expect(beatJitter(3)).toBe(beatJitter(3));
    const values = Array.from({ length: 500 }, (_, i) => beatJitter(i));
    expect(values.every((x) => x >= -1 && x <= 1)).toBe(true);
  });

  test("with HRV, successive differences have about the measured RMSSD", () => {
    const intervals = Array.from({ length: 4000 }, (_, i) => beatInterval(i, 60, 40));
    const diffs = intervals.slice(1).map((x, i) => (x - intervals[i]!) * 1000);
    const rmssd = Math.sqrt(diffs.reduce((sum, d) => sum + d * d, 0) / diffs.length);
    expect(Math.round(rmssd / 5) * 5).toBe(40);
  });

  test("a large HRV is capped at 20% of the interval", () => {
    const intervals = Array.from({ length: 200 }, (_, i) => beatInterval(i, 120, 300));
    const widest = Math.max(...intervals.map((x) => Math.abs(x - 0.5)));
    expect(widest <= MAX_JITTER_SHARE * 0.5).toBe(true);
  });
});

describe("advanceBeat", () => {
  test("moves through the cycle at bpm / 60 per second", () => {
    expect(advanceBeat(BEAT_CLOCK_START, 0.25, 60, null)).toEqual({
      beat: 0,
      phase: 0.25,
    });
    const next = advanceBeat({ beat: 0, phase: 0.9 }, 0.25, 60, null);
    expect([next.beat, round(next.phase)]).toEqual([1, 0.15]);
  });

  test("a faster rate speeds up from the current phase", () => {
    const next = advanceBeat({ beat: 4, phase: 0.5 }, 0.1, 120, null);
    expect([next.beat, round(next.phase)]).toEqual([4, 0.7]);
  });

  test("a long pause runs at most one beat on", () => {
    const next = advanceBeat({ beat: 2, phase: 0.3 }, 30, 60, null);
    expect([next.beat, round(next.phase)]).toEqual([3, 0.3]);
  });
});

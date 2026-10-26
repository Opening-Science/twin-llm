import { describe, expect, test } from "bun:test";

import { nightReadout } from "./live-copy";
import {
  advancePlayback,
  epochAt,
  NIGHT_EPOCHS,
  nightClock,
  nightMinutes,
  nightVitals,
  type Night,
  seekPlayback,
  START_PLAYBACK,
  syntheticNight,
  togglePlayback,
} from "./night-series";

const night = syntheticNight("demo", "2026-10-02");

const tiny: Night = {
  startIso: "2026-10-01T23:00:00Z",
  day: "2026-10-02",
  epochs: [
    { minute: 0, heart: 60, breath: 14, stage: "awake" },
    { minute: 5, heart: null, breath: null, stage: null },
    { minute: 10, heart: 52, breath: 12.5, stage: "deep" },
  ],
};

describe("syntheticNight", () => {
  test("is the same night for the same subject, 23:00 to 07:00 in five-minute epochs", () => {
    expect(syntheticNight("demo", "2026-10-02")).toEqual(night);
    expect(night.startIso).toBe("2026-10-01T23:00:00Z");
    expect(night.epochs.length).toBe(NIGHT_EPOCHS);
    expect(nightMinutes(night)).toBe(480);
    expect(night.epochs.map((epoch) => epoch.minute).slice(0, 3)).toEqual([0, 5, 10]);
    expect(night.epochs.at(-1)?.stage).toBe("awake");
  });

  test("differs between subjects", () => {
    expect(syntheticNight("self", "2026-10-02").epochs).not.toEqual(night.epochs);
  });

  test("has one four-epoch gap where every value is missing, and plausible values elsewhere", () => {
    const missing = night.epochs.filter((epoch) => epoch.heart === null);
    expect(missing.length).toBe(4);
    expect(missing.every((epoch) => epoch.breath === null && epoch.stage === null)).toBe(
      true,
    );
    const heart = night.epochs.flatMap((epoch) =>
      epoch.heart === null ? [] : [epoch.heart],
    );
    const breath = night.epochs.flatMap((epoch) =>
      epoch.breath === null ? [] : [epoch.breath],
    );
    expect(Math.min(...heart) >= 35 && Math.max(...heart) <= 85).toBe(true);
    expect(Math.min(...breath) >= 8 && Math.max(...breath) <= 22).toBe(true);
  });

  test("holds every stage", () => {
    const stages = new Set(night.epochs.map((epoch) => epoch.stage));
    expect([...stages].sort()).toEqual(["awake", "deep", "light", "rem", null].sort());
  });
});

describe("epochAt", () => {
  test("steps, never blends", () => {
    expect(epochAt(tiny, 0)).toBe(tiny.epochs[0]!);
    expect(epochAt(tiny, 4.9)).toBe(tiny.epochs[0]!);
    expect(epochAt(tiny, 12)).toBe(tiny.epochs[2]!);
  });

  test("is null outside the night", () => {
    expect(epochAt(tiny, -1)).toBeNull();
    expect(epochAt(tiny, 15)).toBeNull();
    expect(epochAt(tiny, Number.NaN)).toBeNull();
  });
});

describe("nightVitals", () => {
  test("drives heart and lungs at the epoch's rates, without the HRV glow", () => {
    expect(nightVitals(tiny.epochs[2]!, tiny.day)).toEqual({
      heart: {
        perMinute: 52,
        day: "2026-10-02",
        source: "Synthetic night",
        vital: "heartRate",
      },
      breath: {
        perMinute: 12.5,
        day: "2026-10-02",
        source: "Synthetic night",
        vital: "respiration",
      },
      hrvBelow: null,
    });
  });

  test("a missing value is no rate, so the motion stops", () => {
    expect(nightVitals(tiny.epochs[1]!, tiny.day)).toEqual({
      heart: null,
      breath: null,
      hrvBelow: null,
    });
    expect(nightVitals(null, tiny.day)).toEqual({
      heart: null,
      breath: null,
      hrvBelow: null,
    });
  });
});

describe("playback clock", () => {
  const playing = { ...START_PLAYBACK, playing: true, speed: 300 } as const;

  test("advances by real time times speed", () => {
    expect(advancePlayback(playing, 1000, 480).minute).toBe(5);
  });

  test("does not move while paused", () => {
    expect(advancePlayback(START_PLAYBACK, 1000, 480)).toBe(START_PLAYBACK);
  });

  test("stops on the last epoch at the end of the night", () => {
    expect(advancePlayback({ ...playing, minute: 470 }, 10_000, 480)).toEqual({
      ...playing,
      minute: 475,
      playing: false,
    });
  });

  test("seeking clamps to the night and keeps playing or paused", () => {
    expect(seekPlayback(playing, 600, 480)).toEqual({ ...playing, minute: 475 });
    expect(seekPlayback(START_PLAYBACK, -5, 480)).toEqual(START_PLAYBACK);
  });

  test("play after the end starts over", () => {
    expect(togglePlayback({ ...START_PLAYBACK, minute: 475 }, 480)).toEqual({
      ...START_PLAYBACK,
      minute: 0,
      playing: true,
    });
    expect(togglePlayback(playing, 480)).toEqual({ ...playing, playing: false });
  });
});

describe("nightReadout", () => {
  test("says the time, stage and both rates", () => {
    expect(nightClock(tiny, 10)).toBe("23:10");
    expect(nightClock(tiny, 75)).toBe("00:15");
    expect(nightReadout("23:10", tiny.epochs[2]!)).toBe(
      "23:10 · Deep sleep · heart rate 52 bpm · breathing 12.5 per minute",
    );
  });

  test("says there is no reading in a gap", () => {
    expect(nightReadout("23:05", tiny.epochs[1]!)).toBe("23:05 · no reading");
  });
});

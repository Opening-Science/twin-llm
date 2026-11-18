import { describe, expect, test } from "bun:test";

import { mockKioskDay } from "@/packages/query-tools/mock-kiosk-day";

import { dayShare, dayStrip, MIN_WINDOW_SHARE } from "./kiosk-strip";

const DAY = mockKioskDay("without_diabetes");

describe("dayShare", () => {
  test("midnight, noon and a quarter past eight", () => {
    expect([dayShare("00:00"), dayShare("12:00"), dayShare("08:15")]).toEqual([
      0,
      0.5,
      495 / 1440,
    ]);
  });
});

describe("dayStrip", () => {
  test("one mark per time of the mock day, beats at one minute sharing it", () => {
    const { marks } = dayStrip(DAY, 0);
    expect(marks.map((mark) => mark.at)).toEqual(
      [
        "03:00",
        "06:30",
        "07:30",
        "08:15",
        "10:00",
        "10:30",
        "12:30",
        "13:00",
        "15:30",
        "18:00",
        "18:45",
        "19:30",
        "20:30",
        "22:30",
      ].map(dayShare),
    );
  });

  test("the current beat's time is the one current mark", () => {
    const index = DAY.beats.findIndex((beat) => beat.time === "13:00");
    expect(
      dayStrip(DAY, index)
        .marks.filter((mark) => mark.current)
        .map((mark) => mark.at),
    ).toEqual([dayShare("13:00")]);
    expect(dayStrip(DAY, null).marks.some((mark) => mark.current)).toBe(false);
  });

  test("the window's time is marked worth a look, and nothing else", () => {
    expect(
      dayStrip(DAY, 0)
        .marks.filter((mark) => mark.worth)
        .map((mark) => mark.at),
    ).toEqual([dayShare("20:30")]);
  });

  test("a one-reading window gets a narrow band around its time", () => {
    expect(dayStrip(DAY, 0).bands).toEqual([
      { from: dayShare("20:30") - MIN_WINDOW_SHARE / 2, width: MIN_WINDOW_SHARE },
    ]);
  });

  test("a band near midnight stays inside the day", () => {
    const late = {
      ...DAY,
      worth_a_look: DAY.worth_a_look.map((window) => ({
        ...window,
        from: "23:59",
        to: "23:59",
      })),
    };
    const [only] = dayStrip(late, 0).bands;
    expect(only).toEqual({ from: 1 - MIN_WINDOW_SHARE, width: MIN_WINDOW_SHARE });
  });
});

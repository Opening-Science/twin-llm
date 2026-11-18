import { describe, expect, test } from "bun:test";

import { mockKioskDay } from "@/packages/query-tools/mock-kiosk-day";

import { kioskTourStops, tourBeat } from "./kiosk-tour";

const DAY = mockKioskDay("without_diabetes");

describe("kioskTourStops", () => {
  test("visits each place of the mock day once, in the day's order", () => {
    const stops = kioskTourStops(DAY);
    expect(stops.map((index) => DAY.beats[index]?.view.focus)).toEqual([
      "heart",
      "bloodvasculature",
      "pancreas",
      "liver",
    ]);
    expect(stops).toEqual([0, 3, 4, 5]);
  });

  test("a day without beats has no stops", () => {
    expect(kioskTourStops({ ...DAY, beats: [] })).toEqual([]);
  });
});

describe("tourBeat", () => {
  test("goes round the stops", () => {
    expect([0, 1, 2, 3, 4, 5].map((step) => tourBeat([0, 3, 4, 5], step))).toEqual([
      0, 3, 4, 5, 0, 3,
    ]);
  });

  test("has nothing to show without stops", () => {
    expect(tourBeat([], 3)).toBeNull();
  });
});

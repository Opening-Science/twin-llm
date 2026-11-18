import { describe, expect, test } from "bun:test";

import { mockKioskDay } from "@/packages/query-tools/mock-kiosk-day";

import { kioskFocus, type KioskBeat } from "./kiosk-focus";

const DAY = mockKioskDay("without_diabetes");

const beatAt = (time: string, measure: KioskBeat["measure"]): KioskBeat => {
  const beat = DAY.beats.find((one) => one.time === time && one.measure === measure);
  if (!beat) throw new Error(`no ${measure} beat at ${time}`);
  return beat;
};

describe("kioskFocus", () => {
  test("a heart-rate beat turns the twin to the heart, in the organs layer", () => {
    expect(kioskFocus(beatAt("03:00", "heart_rate"))).toEqual({
      label: "Heart",
      highlights: {
        hra: { kind: "groups", ids: ["heart"] },
        bodyparts3d: { kind: "system", ids: ["cardiovascular"] },
      },
      depth: 3,
    });
  });

  test("the narrated insulin beat turns the twin to the pancreas", () => {
    const focus = kioskFocus(beatAt("08:15", "insulin"));
    expect([focus.label, focus.highlights.hra, focus.depth]).toEqual([
      "Pancreas",
      { kind: "groups", ids: ["pancreas"] },
      3,
    ]);
  });

  test("every beat of the mock day lands on a layer the slider has", () => {
    expect(DAY.beats.map((beat) => kioskFocus(beat).depth)).toEqual(
      DAY.beats.map(
        (beat) => ({ scan: 0, muscle: 1, skeleton: 2, organs: 3 })[beat.view.depth],
      ),
    );
  });
});

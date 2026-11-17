import { describe, expect, test } from "bun:test";

import EXAMPLE from "@/docs/kiosk-day.example.json";
import { kioskDaySchema } from "@/packages/query-tools/kiosk-day";

import { BEAT_FOCUS_PREFIX, beatFocus } from "./beat-focus";

const DAY = kioskDaySchema.parse(EXAMPLE);
const beatAt = (event: string) => {
  const found = DAY.beats.find((beat) => beat.event === event);
  if (!found) throw new Error(`no ${event} beat in the example`);
  return found;
};

describe("beatFocus", () => {
  test("turns the twin to the beat's organ at the organs layer", () => {
    const focus = beatFocus(beatAt("Worth a look"));
    expect(focus.label).toBe("Blood vessels");
    expect(focus.depth).toBe(3);
    expect(focus.highlights.hra).toEqual({ kind: "groups", ids: ["bloodvasculature"] });
    expect(focus.highlights.bodyparts3d).toEqual({
      kind: "system",
      ids: ["cardiovascular"],
    });
  });

  test("a heart beat lights the heart", () => {
    const heart = DAY.beats.find((beat) => beat.view.focus === "heart");
    expect(heart && beatFocus(heart).highlights.hra).toEqual({
      kind: "groups",
      ids: ["heart"],
    });
  });

  test("ids are per beat and carry the day prefix", () => {
    const ids = DAY.beats.map((beat) => beatFocus(beat).id);
    expect(ids.every((id) => id.startsWith(BEAT_FOCUS_PREFIX))).toBe(true);
    expect(beatFocus(DAY.beats[0]!).id).not.toBe(beatFocus(DAY.beats[1]!).id);
  });

  test("the depth follows the layer the server names", () => {
    const beat = DAY.beats[0]!;
    expect(beatFocus({ ...beat, view: { ...beat.view, depth: "scan" } }).depth).toBe(0);
    expect(beatFocus({ ...beat, view: { ...beat.view, depth: "muscle" } }).depth).toBe(1);
  });
});

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import EXAMPLE from "@/docs/kiosk-day.example.json";
import { kioskDaySchema } from "@/packages/query-tools/kiosk-day";

import {
  DAY_REFUSED,
  MY_DAY_DAYS_FAILED,
  MY_DAY_LOADING,
  MY_DAY_MOCK_NOTE,
  MY_DAY_MOCK_OPTION,
  MY_DAY_NOT_RECORDED,
  WORTH_A_LOOK_NONE,
  WORTH_A_LOOK_NOTE,
  MY_DAY_NOTE,
} from "./day-copy";
import { beatFocus } from "./beat-focus";
import { MOCK_CHOICE } from "./day-view";
import { MyDayPanel } from "./my-day-panel";
import { type MyDayState } from "./use-my-day";

const DAY = kioskDaySchema.parse(EXAMPLE);
const noop = () => undefined;

const STATE: MyDayState = {
  days: [{ day: "2026-11-16", readings: 26 }],
  choice: "2026-11-16",
  profile: "without_diabetes",
  day: { ...DAY, activity: "not recorded" },
  error: null,
  selected: null,
  focus: null,
  onChoice: noop,
  onProfile: noop,
  onBeat: noop,
  period: {
    period: "week",
    available: true,
    summary: undefined,
    error: null,
    onPeriod: noop,
  },
};

const html = (state: MyDayState) =>
  renderToStaticMarkup(createElement(MyDayPanel, { state }))
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"');

describe("MyDayPanel", () => {
  test("draws every beat's line and body as given, in order", () => {
    const out = html(STATE);
    // Each line is found after the one before it, so repeats count and order holds.
    const found = DAY.beats.reduce<number>(
      (from, beat) => (from < 0 ? from : out.indexOf(beat.line, from + 1)),
      0,
    );
    expect(found).toBeGreaterThan(0);
    expect(out).toContain(DAY.beats[0]!.body.text);
  });

  test("always shows the notice, the placeholder and UTC", () => {
    const out = html(STATE);
    expect(out).toContain(DAY.notice);
    expect(out).toContain(`placeholders until ${DAY.thresholds.reviewer}`);
    expect(out).toContain("Times are UTC.");
    expect(out).toContain(MY_DAY_NOT_RECORDED);
  });

  test("offers the person's days and the mock, which is labelled as mock", () => {
    const out = html({ ...STATE, choice: MOCK_CHOICE, day: DAY });
    expect(out).toContain("16 Nov 2026 · 26 readings");
    expect(out).toContain(MY_DAY_MOCK_OPTION);
    expect(out).toContain(MY_DAY_MOCK_NOTE);
    expect(html(STATE)).not.toContain(MY_DAY_MOCK_NOTE);
  });

  test("a narrated beat shows no number", () => {
    const narrated = DAY.beats.find((beat) => beat.source === "narrated");
    expect(narrated?.line).toContain("narrated, not measured");
    expect(narrated?.line).not.toMatch(/\d/);
  });

  test("each beat is a toggle; the pressed one says what the twin shows", () => {
    const index = DAY.beats.findIndex((beat) => beat.event === "Worth a look");
    const focus = beatFocus(DAY.beats[index]!);
    const out = html({ ...STATE, selected: index, focus });
    expect(out.match(/aria-pressed="true" class="twin-beat-button"/g)).toHaveLength(1);
    expect(out.match(/aria-pressed="false" class="twin-beat-button"/g)).toHaveLength(
      DAY.beats.length - 1,
    );
    expect(out).toContain("The twin shows: Blood vessels.");
    expect(html(STATE)).not.toContain("The twin shows");
  });

  test("marks a window's beat in words, an icon and a shape, never by colour alone", () => {
    const out = html(STATE);
    expect(out.match(/data-worth="true"/g)).toHaveLength(1);
    const beat = out.slice(out.indexOf('data-worth="true"'));
    expect(beat.indexOf("<svg")).toBeLessThan(beat.indexOf("Worth a look"));
  });

  test("lists each window with its line, rule and a way to show its beat", () => {
    const out = html(STATE);
    expect(out).toContain("20:30 · Glucose · furthest 175 mg/dL");
    expect(out).toContain(DAY.worth_a_look[0]!.rule);
    expect(out).toContain(WORTH_A_LOOK_NOTE);
    expect(out).toContain("Show the 20:30 beat");
  });

  test("blood and sensor windows at one time each press their own beat", () => {
    const blood = DAY.beats.findIndex((beat) => beat.worth_a_look);
    const sensorBeat = {
      ...DAY.beats[blood]!,
      value: 152,
      line: "Sensor glucose up · about 152 mg/dL · derived",
    };
    const beats = [
      ...DAY.beats.slice(0, blood + 1),
      sensorBeat,
      ...DAY.beats.slice(blood + 1),
    ];
    const windows = [
      ...DAY.worth_a_look,
      { ...DAY.worth_a_look[0]!, extreme: 152, rule: "Sensor glucose above 140 mg/dL" },
    ];
    const out = html({
      ...STATE,
      day: { ...DAY, beats, worth_a_look: windows },
      selected: blood + 1,
    });
    // Only the sensor window's button is pressed, so the two are told apart.
    const buttons =
      out.match(/aria-pressed="(true|false)"[^>]*>Show the 20:30 beat/g) ?? [];
    expect(buttons.map((one) => one.includes('"true"'))).toEqual([false, true]);
  });

  test("says so when nothing is past the thresholds", () => {
    const quiet = {
      ...DAY,
      worth_a_look: [],
      beats: DAY.beats.filter((b) => !b.worth_a_look),
    };
    const out = html({ ...STATE, day: quiet });
    expect(out).toContain(WORTH_A_LOOK_NONE);
    expect(out).not.toContain('data-worth="true"');
  });

  test("shows the route's sentence instead of beats on a refusal", () => {
    const out = html({ ...STATE, day: undefined, error: DAY_REFUSED["no-readings"] });
    expect(out).toContain(DAY_REFUSED["no-readings"]);
    expect(out).not.toContain(DAY.notice);
  });

  test("opens with a plain line, naming no tool", () => {
    expect(MY_DAY_NOTE).toBe("Your day of heart rate and blood sugar, step by step.");
    expect(html(STATE)).toContain(MY_DAY_NOTE);
  });

  test("says when the person's days did not load, rather than offering the mock silently", () => {
    const out = html({ ...STATE, days: null, choice: MOCK_CHOICE, day: DAY });
    expect(out).toContain(MY_DAY_DAYS_FAILED);
    expect(out).toContain(MY_DAY_MOCK_OPTION);
    expect(html(STATE)).not.toContain(MY_DAY_DAYS_FAILED);
  });

  test("says it is loading before the days are in", () => {
    expect(html({ ...STATE, days: undefined, day: undefined })).toContain(MY_DAY_LOADING);
  });
});

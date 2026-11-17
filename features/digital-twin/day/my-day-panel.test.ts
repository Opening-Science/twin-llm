import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import EXAMPLE from "@/docs/kiosk-day.example.json";
import { kioskDaySchema } from "@/packages/query-tools/kiosk-day";

import {
  DAY_REFUSED,
  MY_DAY_LOADING,
  MY_DAY_MOCK_NOTE,
  MY_DAY_MOCK_OPTION,
  MY_DAY_NOT_RECORDED,
} from "./day-copy";
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
  onChoice: noop,
  onProfile: noop,
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

  test("shows the route's sentence instead of beats on a refusal", () => {
    const out = html({ ...STATE, day: undefined, error: DAY_REFUSED["no-readings"] });
    expect(out).toContain(DAY_REFUSED["no-readings"]);
    expect(out).not.toContain(DAY.notice);
  });

  test("says it is loading before the days are in", () => {
    expect(html({ ...STATE, days: undefined, day: undefined })).toContain(MY_DAY_LOADING);
  });
});

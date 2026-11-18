import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { KIOSK_DAY_NOTICE } from "@/packages/query-tools/kiosk-day";
import { mockKioskDay } from "@/packages/query-tools/mock-kiosk-day";

import { KioskBeatCard } from "./kiosk-beat";
import {
  KIOSK_ATTRACT,
  KIOSK_ATTRACT_NOTE,
  KIOSK_FOOTER,
  KIOSK_MOCK_NOTE,
  KIOSK_NEEDS_WEBGL,
  KIOSK_START,
  KIOSK_SUBTITLE,
  KIOSK_TITLE,
  KIOSK_UTC,
  KIOSK_WORTH_A_LOOK_NOTE,
} from "./kiosk-copy";
import { KioskScreen } from "./kiosk-screen";

const DAY = mockKioskDay("without_diabetes");

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, "&")
        .trim(),
    )
    .filter(Boolean);

const NOTES = [
  KIOSK_DAY_NOTICE,
  `${KIOSK_MOCK_NOTE} Thresholds are placeholders until Robin confirms them. ${KIOSK_UTC}`,
];

describe("KioskScreen", () => {
  const html = renderToStaticMarkup(createElement(KioskScreen, { day: DAY }));

  test("opens on the attract loop: the title, the call to press, and the research line", () => {
    expect(text(html)).toEqual([
      KIOSK_TITLE,
      KIOSK_SUBTITLE,
      KIOSK_ATTRACT,
      KIOSK_ATTRACT_NOTE,
      KIOSK_FOOTER,
    ]);
  });

  test("the whole screen is one button, which starts the day", () => {
    expect(html).toContain(
      `<button type="button" class="kiosk-press" aria-label="${KIOSK_START}">`,
    );
  });

  test("says which phase it is in, for the attract styles", () => {
    expect(html).toContain('data-phase="attract"');
  });

  test("says the body is synthetic and not advice", () => {
    expect(KIOSK_FOOTER).toContain("synthetic");
    expect(KIOSK_FOOTER).toContain("not advice");
  });

  test("is dark whatever the machine's theme", () => {
    expect(html).toStartWith('<div class="kiosk dark"');
  });

  test("before hydration shows neither the twin nor the WebGL note", () => {
    expect(html).not.toContain("kiosk-twin");
    expect(html).not.toContain(KIOSK_NEEDS_WEBGL);
  });
});

describe("KioskBeatCard", () => {
  test("the first beat as written, with the notes that always go with the day", () => {
    expect(
      text(
        renderToStaticMarkup(
          createElement(KioskBeatCard, { day: DAY, index: 0, focusLabel: "Heart" }),
        ),
      ),
    ).toEqual([
      "1 of 18",
      "03:00",
      "Deep sleep",
      "Heart rate steady · about 52 /min · measured",
      "The heart keeps a steady pace.",
      "The twin shows: Heart.",
      ...NOTES,
    ]);
  });

  const card = (index: number) =>
    text(
      renderToStaticMarkup(
        createElement(KioskBeatCard, { day: DAY, index, focusLabel: "Blood vessels" }),
      ),
    );

  test("a window's beat says worth a look in words, not only by a mark", () => {
    const index = DAY.beats.findIndex((beat) => beat.worth_a_look);
    expect(card(index)).toEqual([
      `${index + 1} of 18`,
      "20:30",
      "Worth a look",
      KIOSK_WORTH_A_LOOK_NOTE,
      "Blood glucose up · about 175 mg/dL · derived",
      "Blood sugar stays past the threshold for a while. Blood glucose above 140 mg/dL (placeholder, without diabetes).",
      "The twin shows: Blood vessels.",
      ...NOTES,
    ]);
  });

  test("a narrated beat shows no number", () => {
    const index = DAY.beats.findIndex((beat) => beat.source === "narrated");
    expect(card(index)[3]).toBe("Insulin up · narrated, not measured");
  });

  test("past the last beat there is nothing to draw", () => {
    expect(card(DAY.beats.length)).toEqual([]);
  });
});

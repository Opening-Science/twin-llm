import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { mockKioskDay } from "@/packages/query-tools/mock-kiosk-day";

import { KioskDayStrip } from "./kiosk-strip-view";

const DAY = mockKioskDay("without_diabetes");

const html = (current: number | null) =>
  renderToStaticMarkup(createElement(KioskDayStrip, { day: DAY, current }));

const count = (markup: string, needle: string) => markup.split(needle).length - 1;

describe("KioskDayStrip", () => {
  test("a tick per beat time, one of them current", () => {
    const markup = html(0);
    expect(count(markup, 'class="kiosk-strip-mark"')).toBe(14);
    expect(count(markup, "data-current")).toBe(1);
    expect(markup).toContain('data-current="" style="left:12.500%"');
  });

  test("the worth-a-look time is a ring over one hatched band", () => {
    const markup = html(0);
    expect(count(markup, "data-worth")).toBe(1);
    expect(count(markup, 'class="kiosk-strip-band"')).toBe(1);
  });

  test("is hidden from screen readers, since the card says the same in words", () => {
    expect(html(null)).toStartWith('<div class="kiosk-strip" aria-hidden="true">');
    expect(count(html(null), "data-current")).toBe(0);
  });
});

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

  test("each hour label sits at its own time on the track, as the ticks do", () => {
    const markup = html(0);
    expect(markup).toContain('<span style="left:0.000%">00:00</span>');
    expect(markup).toContain('<span style="left:25.000%">06:00</span>');
    expect(markup).toContain('<span style="left:50.000%">12:00</span>');
    expect(markup).toContain('<span style="left:75.000%">18:00</span>');
    expect(markup).toContain('<span style="left:100.000%">24:00</span>');
  });

  test("is hidden from screen readers, since the card says the same in words", () => {
    expect(html(null)).toStartWith('<div class="kiosk-strip" aria-hidden="true">');
    expect(count(html(null), "data-current")).toBe(0);
  });
});

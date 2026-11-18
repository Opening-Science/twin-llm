import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  KIOSK_FOOTER,
  KIOSK_NEEDS_WEBGL,
  KIOSK_SUBTITLE,
  KIOSK_TITLE,
} from "./kiosk-copy";
import { KioskScreen } from "./kiosk-screen";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((line) => line.replace(/&#x27;/g, "'").trim())
    .filter(Boolean);

describe("KioskScreen", () => {
  const html = renderToStaticMarkup(createElement(KioskScreen));

  test("shows the title, whose body it is, and the research line, in that order", () => {
    expect(text(html)).toEqual([KIOSK_TITLE, KIOSK_SUBTITLE, KIOSK_FOOTER]);
  });

  test("says the body is synthetic and not advice", () => {
    expect(KIOSK_FOOTER).toContain("synthetic");
    expect(KIOSK_FOOTER).toContain("not advice");
  });

  test("is dark whatever the machine's theme", () => {
    expect(html).toStartWith('<div class="kiosk dark">');
  });

  test("before hydration shows neither the twin nor the WebGL note", () => {
    expect(html).not.toContain("kiosk-twin");
    expect(html).not.toContain(KIOSK_NEEDS_WEBGL);
  });
});

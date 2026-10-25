import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Button, buttonClassName } from "./button";

describe("Button", () => {
  test("renders a native button that does not submit forms by default", () => {
    const html = renderToStaticMarkup(createElement(Button, null, "Try again"));
    expect(html).toBe(
      `<button type="button" class="${buttonClassName()}">Try again</button>`,
    );
  });

  test("keeps an explicit submit type and the disabled attribute", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { type: "submit", disabled: true }, "Save"),
    );
    expect(html).toContain('type="submit"');
    expect(html).toContain('disabled=""');
  });
});

describe("buttonClassName", () => {
  test("secondary md is the outline button the screens used to copy", () => {
    expect(buttonClassName()).toBe(
      "inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 rounded-lg px-3 py-1.5 text-sm border-input hover:bg-muted border",
    );
  });

  test("pill overrides the size radius, and a caller class wins over the base", () => {
    expect(buttonClassName({ variant: "pill", size: "sm", className: "mt-3" })).toBe(
      "inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 px-2.5 py-1 text-xs border-input hover:bg-muted rounded-full border mt-3",
    );
  });

  test("ghost has no border and primary uses the accent", () => {
    expect(buttonClassName({ variant: "ghost" })).not.toContain("border");
    expect(buttonClassName({ variant: "primary" })).toContain(
      "bg-primary text-primary-foreground",
    );
  });
});

import { describe, expect, test } from "bun:test";

import { centredScrollLeft, rowOverflow } from "./row-overflow";

// The seven Customize tabs at 375px: a 341px row holding 510px of tabs.
const PHONE = { clientWidth: 341, scrollWidth: 510 };

describe("rowOverflow", () => {
  test("at the start of a phone row only the end has more tabs", () => {
    expect(rowOverflow({ ...PHONE, scrollLeft: 0 })).toEqual({ start: false, end: true });
  });

  test("scrolled part way, both sides have more tabs", () => {
    expect(rowOverflow({ ...PHONE, scrollLeft: 80 })).toEqual({ start: true, end: true });
  });

  test("scrolled to the end only the start has more tabs", () => {
    expect(rowOverflow({ ...PHONE, scrollLeft: 169 })).toEqual({
      start: true,
      end: false,
    });
  });

  test("a row that fits has nothing out of sight, even with a fractional position", () => {
    expect(rowOverflow({ scrollLeft: 0.5, clientWidth: 510, scrollWidth: 510 })).toEqual({
      start: false,
      end: false,
    });
  });
});

describe("centredScrollLeft", () => {
  test("puts a tab in the middle of the row", () => {
    expect(centredScrollLeft(332, 100, 341)).toBe(211.5);
  });

  test("never scrolls before the first tab", () => {
    expect(centredScrollLeft(3, 61, 341)).toBe(0);
  });
});

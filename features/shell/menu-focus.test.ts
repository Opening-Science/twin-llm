import { describe, expect, test } from "bun:test";

import { menuFocusIndex } from "./menu-focus";

describe("menuFocusIndex", () => {
  test("Down moves to the next item and wraps to the first", () => {
    expect(menuFocusIndex(0, 4, "ArrowDown")).toBe(1);
    expect(menuFocusIndex(3, 4, "ArrowDown")).toBe(0);
  });

  test("Up moves to the previous item and wraps to the last", () => {
    expect(menuFocusIndex(2, 4, "ArrowUp")).toBe(1);
    expect(menuFocusIndex(0, 4, "ArrowUp")).toBe(3);
  });

  test("with no item focused, Down starts at the first and Up at the last", () => {
    expect(menuFocusIndex(-1, 4, "ArrowDown")).toBe(0);
    expect(menuFocusIndex(-1, 4, "ArrowUp")).toBe(3);
  });

  test("Home and End jump to the ends", () => {
    expect(menuFocusIndex(2, 4, "Home")).toBe(0);
    expect(menuFocusIndex(1, 4, "End")).toBe(3);
  });

  test("other keys and an empty menu leave focus to the browser", () => {
    expect(menuFocusIndex(1, 4, "Tab")).toBe(null);
    expect(menuFocusIndex(1, 4, "a")).toBe(null);
    expect(menuFocusIndex(0, 0, "ArrowDown")).toBe(null);
  });
});

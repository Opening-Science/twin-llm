import { describe, expect, test } from "bun:test";

import { menuKeyTarget } from "./menu-keys";

describe("menuKeyTarget", () => {
  test("down and up wrap", () => {
    expect(menuKeyTarget("ArrowDown", 0, 4)).toBe(1);
    expect(menuKeyTarget("ArrowDown", 3, 4)).toBe(0);
    expect(menuKeyTarget("ArrowUp", 0, 4)).toBe(3);
    expect(menuKeyTarget("ArrowUp", 2, 4)).toBe(1);
  });

  test("from nothing focused, down starts at the first and up at the last", () => {
    expect(menuKeyTarget("ArrowDown", -1, 4)).toBe(0);
    expect(menuKeyTarget("ArrowUp", -1, 4)).toBe(3);
  });

  test("Home and End jump to the ends; other keys are left alone", () => {
    expect(menuKeyTarget("Home", 2, 4)).toBe(0);
    expect(menuKeyTarget("End", 1, 4)).toBe(3);
    expect(menuKeyTarget("Tab", 1, 4)).toBeNull();
    expect(menuKeyTarget("ArrowDown", -1, 0)).toBeNull();
  });
});

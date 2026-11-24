import { describe, expect, test } from "bun:test";

import { organFocusOpacity } from "./organ-focus";

describe("organ focus", () => {
  test("fades organs and vessels while keeping the HRA heart more visible", () => {
    expect(
      organFocusOpacity({ system: "cardiovascular", group: "heart" }, true, false),
    ).toBe(0.9);
    expect(
      organFocusOpacity({ system: "cardiovascular", group: null }, true, false),
    ).toBe(0.17);
    expect(organFocusOpacity({ system: "respiratory", group: null }, true, false)).toBe(
      0.12,
    );
  });

  test("keeps the merged cardiovascular mesh visible when a fitted atlas has no heart mask", () => {
    expect(organFocusOpacity({ system: "cardiovascular", group: null }, true, true)).toBe(
      0.9,
    );
    expect(organFocusOpacity({ system: "respiratory", group: null }, true, true)).toBe(
      0.12,
    );
  });

  test("restores normal opacity outside focus mode", () => {
    expect(
      organFocusOpacity({ system: "cardiovascular", group: "heart" }, false, false),
    ).toBe(1);
    expect(organFocusOpacity({ system: "respiratory", group: null }, false, false)).toBe(
      1,
    );
  });
});

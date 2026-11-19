import { describe, expect, test } from "bun:test";

import { THEME_TOGGLE_LABEL } from "./theme-toggle";

describe("THEME_TOGGLE_LABEL", () => {
  test("English keeps the label the button had", () => {
    expect(THEME_TOGGLE_LABEL.en).toEqual({
      light: "Switch to light theme",
      dark: "Switch to dark theme",
    });
  });

  test("German names the theme it offers", () => {
    expect(THEME_TOGGLE_LABEL.de.light).toContain("hellen");
    expect(THEME_TOGGLE_LABEL.de.dark).toContain("dunklen");
  });
});

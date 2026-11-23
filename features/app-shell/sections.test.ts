import { describe, expect, test } from "bun:test";

import { isCurrentSection, SECTIONS } from "./sections";

describe("sections", () => {
  test("are listed in the sidebar's order", () => {
    expect(SECTIONS.map(({ key, href }) => [key, href])).toEqual([
      ["home", "/"],
      ["dashboard", "/dashboard"],
      ["twin", "/digital-twin"],
      ["customize", "/customize"],
      ["models", "/models"],
      ["lab", "/lab"],
      ["docs", "/docs"],
      ["start", "/start"],
    ]);
  });

  test("home is current on / and on saved threads", () => {
    expect(isCurrentSection("/", "/")).toBe(true);
    expect(isCurrentSection("/", "/t/abc")).toBe(true);
    expect(isCurrentSection("/", "/models")).toBe(false);
  });

  test("a section is current on its path and below, never on a longer name", () => {
    expect(isCurrentSection("/models", "/models")).toBe(true);
    expect(isCurrentSection("/models", "/models/x")).toBe(true);
    expect(isCurrentSection("/models", "/modelsx")).toBe(false);
    expect(isCurrentSection("/customize", "/customize/tasks")).toBe(true);
    expect(isCurrentSection("/lab", null)).toBe(false);
    expect(isCurrentSection("/dashboard", "/dashboard")).toBe(true);
    expect(isCurrentSection("/", "/dashboard")).toBe(false);
  });
});

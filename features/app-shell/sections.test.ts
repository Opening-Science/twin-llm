import { describe, expect, test } from "bun:test";

import { formatNumber } from "@/infrastructure/format-measure";

import { isCurrentSection, modelCountText, SECTIONS } from "./sections";

describe("sections", () => {
  test("are listed in the sidebar's order", () => {
    expect(SECTIONS.map(({ label, href }) => [label, href])).toEqual([
      ["TwinLLM", "/"],
      ["Digital Twin", "/digital-twin"],
      ["Customize", "/customize"],
      ["Models", "/models"],
      ["Lab", "/lab"],
      ["Docs", "/docs"],
      ["Get started", "/start"],
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
  });
});

describe("modelCountText", () => {
  test("counts models, grouping thousands as the display locale does", () => {
    const whole = (value: number) => formatNumber(value, 0);
    expect(modelCountText(1, whole)).toBe("1 model");
    expect(modelCountText(3, whole)).toBe("3 models");
    expect(modelCountText(1204, whole)).toBe("1,204 models");
  });
});

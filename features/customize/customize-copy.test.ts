import { describe, expect, test } from "bun:test";

import { CUSTOMIZE_COPY } from "./customize-copy";
import { CUSTOMIZE_TABS } from "./customize-tabs";

const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : typeof value === "object" && value !== null
      ? Object.values(value).flatMap(strings)
      : [];

describe("CUSTOMIZE_COPY", () => {
  test("English keeps the section names the tabs had, in order", () => {
    expect(CUSTOMIZE_TABS.map(({ key }) => CUSTOMIZE_COPY.en.tabs[key])).toEqual([
      "Skills",
      "Agents",
      "Memory",
      "Tasks",
      "Data",
      "Connectors",
      "Privacy",
      "Settings",
    ]);
  });

  test("German has every entry, translated except the loanword Skills", () => {
    const en = strings(CUSTOMIZE_COPY.en);
    const de = strings(CUSTOMIZE_COPY.de);
    expect(de.length).toBe(en.length);
    de.forEach((text, index) => {
      expect(text.trim()).not.toBe("");
      if (text !== "Skills") expect(text).not.toBe(en[index]);
    });
  });
});

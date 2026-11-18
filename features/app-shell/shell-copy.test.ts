import { describe, expect, test } from "bun:test";

import { LOCALES } from "@/infrastructure/locale/locale";
import { formatNumber } from "@/infrastructure/format-measure";

import { SECTIONS } from "./sections";
import { SHELL_COPY } from "./shell-copy";

const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : typeof value === "object" && value !== null
      ? Object.values(value).flatMap(strings)
      : [];

describe("SHELL_COPY", () => {
  test("names every section in every language", () => {
    for (const locale of LOCALES)
      for (const { key } of SECTIONS)
        expect(SHELL_COPY[locale].sections[key].trim()).not.toBe("");
  });

  test("English keeps the names the sidebar had", () => {
    expect(SECTIONS.map(({ key }) => SHELL_COPY.en.sections[key])).toEqual([
      "TwinLLM",
      "Digital Twin",
      "Customize",
      "Models",
      "Lab",
      "Docs",
      "Get started",
    ]);
  });

  test("German differs from English everywhere except names and loanwords", () => {
    const same = new Set(["TwinLLM", "Navigation"]);
    const en = strings(SHELL_COPY.en);
    const de = strings(SHELL_COPY.de);
    expect(de.length).toBe(en.length);
    de.forEach((text, index) => {
      expect(text.trim()).not.toBe("");
      if (!same.has(text)) expect(text).not.toBe(en[index]);
    });
  });
});

describe("models", () => {
  const whole = (value: number) => formatNumber(value, 0);

  test("counts models in English, grouping thousands as the display locale does", () => {
    const { models } = SHELL_COPY.en;
    expect(models(whole(1), true)).toBe("1 model");
    expect(models(whole(3), false)).toBe("3 models");
    expect(models(whole(1204), false)).toBe("1,204 models");
  });

  test("counts models in German", () => {
    const { models } = SHELL_COPY.de;
    expect(models(whole(1), true)).toBe("1 Modell");
    expect(models(whole(3), false)).toBe("3 Modelle");
  });
});

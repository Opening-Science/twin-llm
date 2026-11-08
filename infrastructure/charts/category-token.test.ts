import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CATEGORY_TOKEN,
  REFERENCE_TEXT_CLASS,
  categoryTextClass,
  conditionToken,
  tokenTextClass,
  type Category,
} from "./category-token";

const css = readFileSync(join(import.meta.dir, "../../app/globals.css"), "utf8");
const themed = (token: string): boolean => css.includes(`--color-${token}:`);

describe("category colours", () => {
  test("the agreed mapping", () => {
    expect(CATEGORY_TOKEN).toEqual({
      sleep: "chart-4",
      heart: "chart-3",
      hrv: "chart-3",
      activity: "chart-2",
      steps: "chart-2",
      readiness: "chart-1",
      recovery: "chart-1",
      vitals: "chart-1",
    });
  });

  test("no category draws in the reference grey", () => {
    expect(Object.values(CATEGORY_TOKEN)).not.toContain("chart-5");
  });

  test("every category's colour is in the Tailwind theme", () => {
    const tokens = new Set<string>(Object.values(CATEGORY_TOKEN));
    expect([...tokens].filter((t) => !themed(t))).toEqual([]);
    expect(themed("chart-reference")).toBe(true);
  });

  test("a category's class names its own token", () => {
    for (const category of Object.keys(CATEGORY_TOKEN) as Category[]) {
      expect(categoryTextClass(category)).toBe(tokenTextClass(CATEGORY_TOKEN[category]));
    }
    expect(REFERENCE_TEXT_CLASS).toBe(tokenTextClass("chart-reference"));
    expect(REFERENCE_TEXT_CLASS).not.toBe(categoryTextClass("sleep"));
  });
});

describe("research conditions", () => {
  test("take the series in order, then repeat", () => {
    expect([0, 1, 2, 3, 4, 5].map(conditionToken)).toEqual([
      "chart-1",
      "chart-2",
      "chart-3",
      "chart-4",
      "chart-1",
      "chart-2",
    ]);
  });

  test("never fall outside the four series", () => {
    expect(conditionToken(-1)).toBe("chart-4");
    expect(conditionToken(2.7)).toBe("chart-3");
  });
});

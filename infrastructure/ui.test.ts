import { expect, test } from "bun:test";

import { cn } from "./ui";

test("a theme type step and a text colour both survive", () => {
  expect(cn("text-hero", "text-chart-1").split(" ").sort()).toEqual([
    "text-chart-1",
    "text-hero",
  ]);
  expect(cn("text-axis text-muted-foreground").split(" ")).toHaveLength(2);
});

test("a later size still overrides an earlier one", () => {
  expect(cn("text-sm", "text-insight")).toBe("text-insight");
  expect(cn("text-axis", "text-xs")).toBe("text-xs");
});

test("a later colour still overrides an earlier one", () => {
  expect(cn("text-chart-1", "text-chart-2")).toBe("text-chart-2");
});

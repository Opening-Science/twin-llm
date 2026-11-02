import { describe, expect, test } from "bun:test";

import type { GbdRow } from "@/packages/gbd-mcp/normalize";

import { unseenPanelRows } from "./panel-rows";

/** MADE-UP rows; the values are not IHME estimates. */
const row = (location: string, value: number): GbdRow => ({
  measure: "hale",
  cause: "",
  location,
  year: "2023",
  sex: "both",
  age: "at_birth",
  value,
  lower: null,
  upper: null,
  unit: "years",
  source: "IHME GBD 2023",
});

describe("unseenPanelRows (#403)", () => {
  test("keeps each estimate once across calls", () => {
    const seen = new Set<string>();
    expect(
      unseenPanelRows(seen, [row("Switzerland", 70.5), row("Global", 61.5)]),
    ).toEqual([row("Switzerland", 70.5), row("Global", 61.5)]);
    expect(
      unseenPanelRows(seen, [row("Switzerland", 70.5), row("Germany", 68.5)]),
    ).toEqual([row("Germany", 68.5)]);
    expect(
      unseenPanelRows(new Set(), [{ ...row("Switzerland", 70.5), year: "2022" }]),
    ).toHaveLength(1);
  });
});

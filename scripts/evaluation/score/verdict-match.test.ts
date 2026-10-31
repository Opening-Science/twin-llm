import { describe, expect, test } from "bun:test";

import {
  inventsRelation,
  matchesVerdict,
  plantedVerdictOf,
  statedVerdicts,
} from "./verdict-match";

describe("statedVerdicts", () => {
  test("finds the tool's phrases as whole words, any case, any spacing", () => {
    expect(statedVerdicts("The verdict is Raised (3.09, 2.07 to 4.63).")).toEqual([
      "raised",
    ]);
    expect(statedVerdicts("No clear\ndifference; too few events before 55.")).toEqual([
      "no clear difference",
      "too few events",
    ]);
    expect(statedVerdicts("The rate is higher after onset.")).toEqual([]);
    expect(statedVerdicts("praised")).toEqual([]);
  });
});

describe("matchesVerdict", () => {
  test("the target phrase and no other", () => {
    expect(matchesVerdict("Verdict: raised.", "raised")).toBe(true);
    expect(
      matchesVerdict("Not raised: no clear difference.", "no clear difference"),
    ).toBe(false);
    expect(matchesVerdict("It is higher.", "raised")).toBe(false);
  });
});

describe("inventsRelation", () => {
  test("raised or lowered where the scripted verdict is no clear difference", () => {
    expect(inventsRelation("AF raised Alzheimer's.", "no clear difference")).toBe(true);
    expect(inventsRelation("Lowered after onset.", "no clear difference")).toBe(true);
    expect(inventsRelation("No clear difference.", "no clear difference")).toBe(false);
    expect(inventsRelation("Raised.", "raised")).toBe(false);
  });
});

describe("plantedVerdictOf", () => {
  test("reads the planted tag", () => {
    expect(plantedVerdictOf(["hb-verdict", "planted:raised"])).toBe("raised");
    expect(plantedVerdictOf(["planted:no-clear-difference"])).toBe("no clear difference");
    expect(plantedVerdictOf(["hb-decline"])).toBeNull();
  });
});

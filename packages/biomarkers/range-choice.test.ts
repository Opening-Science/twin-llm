import { describe, expect, test } from "bun:test";

import { type ReferenceInterval } from "./anchor-layer";
import { biomarkerByLoinc } from "./catalogue";
import { missingFacts, placeValue, rangeChoice } from "./range-choice";

const interval = (population: string): ReferenceInterval =>
  ({
    population,
    low: 1,
    high: 2,
    unitUcum: "mg/dL",
    blocked: false,
  }) as ReferenceInterval;

describe("biomarkerByLoinc", () => {
  test("finds the Anchor marker by exact code, null when Anchor has none", () => {
    expect(biomarkerByLoinc("4548-4")?.id).toBe("BM-139");
    expect(biomarkerByLoinc("8867-4")).toBeNull();
  });
});

describe("rangeChoice", () => {
  test("a general_adult range is chosen with no facts", () => {
    const choice = rangeChoice("BM-139");
    expect(choice.kind).toBe("range");
    expect(
      choice.kind === "range" ? [choice.interval.high, choice.interval.unitUcum] : null,
    ).toEqual([5.7, "%"]);
  });

  test("with no facts held, the range names what it depends on, never a guess", () => {
    expect(rangeChoice("BM-107")).toEqual({ kind: "depends", on: ["sex", "age"] });
    expect(rangeChoice("BM-072")).toEqual({ kind: "depends", on: ["age"] });
    expect(rangeChoice("BM-077")).toEqual({ kind: "depends", on: ["timing"] });
    expect(rangeChoice("BM-128")).toEqual({ kind: "depends", on: ["timing"] });
    expect(rangeChoice("BM-311")).toEqual({ kind: "depends", on: ["sex", "timing"] });
  });

  test("a fact held drops out; a range that then fits is chosen", () => {
    expect(rangeChoice("BM-107", { sex: "female" }).kind).toBe("range");
    expect(rangeChoice("BM-107", { ageYears: 50 })).toEqual({
      kind: "depends",
      on: ["sex"],
    });
  });

  test("a marker Anchor publishes no range for has none", () => {
    expect(rangeChoice("BM-423")).toEqual({ kind: "none" });
  });
});

describe("missingFacts", () => {
  test("several ranges that ask for nothing depend on no fact", () => {
    expect(
      missingFacts([interval("general_adult"), interval("general_adult")], {}),
    ).toEqual([]);
  });

  test("an unreadable population asks for nothing", () => {
    expect(missingFacts([interval("pregnant_trimester_2")], {})).toEqual([]);
  });

  test("timing is missing only for a qualifier the context does not hold", () => {
    expect(
      missingFacts([interval("fasting_adult")], { qualifiers: ["fasting"] }),
    ).toEqual([]);
    expect(missingFacts([interval("time_vor_10h")], { qualifiers: ["fasting"] })).toEqual(
      ["timing"],
    );
  });
});

describe("placeValue", () => {
  const sodium = {
    ...interval("general_adult"),
    low: 135,
    high: 145,
    unitUcum: "mmol/L",
  };

  test("below, within and above, bounds inclusive", () => {
    expect(placeValue(134.9, "mmol/L", sodium)).toEqual({
      kind: "position",
      position: "below",
    });
    expect(placeValue(145, "mmol/L", sodium)).toEqual({
      kind: "position",
      position: "within",
    });
    expect(placeValue(145.1, "mmol/L", sodium)).toEqual({
      kind: "position",
      position: "above",
    });
  });

  test("another unit is named, never converted", () => {
    expect(placeValue(140, "meq/L", sodium)).toEqual({
      kind: "unit-mismatch",
      unit: "meq/L",
      rangeUnit: "mmol/L",
    });
  });

  test("no interval, or a D11 interval, gives no position", () => {
    expect(placeValue(140, "mmol/L", null)).toEqual({ kind: "none" });
    expect(placeValue(140, "mmol/L", { ...sodium, blocked: true })).toEqual({
      kind: "none",
    });
  });
});

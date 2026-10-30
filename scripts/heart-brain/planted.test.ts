import { describe, expect, test } from "bun:test";

import { agreementOf, PLANTED_RULES, recoveredOf } from "./planted";

const ratio = (value: number, low: number, high: number) => ({
  ratio: value,
  ci: { low, high },
});

describe("recoveredOf", () => {
  test("judges the interval against 1", () => {
    expect(recoveredOf(ratio(2, 1.5, 3))).toBe("raised");
    expect(recoveredOf(ratio(0.5, 0.3, 0.8))).toBe("lowered");
    expect(recoveredOf(ratio(1.1, 0.8, 1.5))).toBe("no clear difference");
    expect(recoveredOf(null)).toBe("too few events");
  });
});

describe("agreementOf", () => {
  test("planted rules must be raised to count as recovered", () => {
    expect(agreementOf("direct", "raised")).toBe("recovered");
    expect(agreementOf("indirect", "no clear difference")).toBe("not recovered");
    expect(agreementOf("direct", "too few events")).toBe("undecided");
  });

  test("with no rule, a difference is an association through shared inputs", () => {
    expect(agreementOf("none", "no clear difference")).toBe("consistent with no rule");
    expect(agreementOf("none", "raised")).toBe("association without a direct rule");
    expect(agreementOf("none", "lowered")).toBe("association without a direct rule");
  });
});

describe("PLANTED_RULES", () => {
  test("ids are unique and AF then stroke is planted directly", () => {
    expect(new Set(PLANTED_RULES.map((rule) => rule.id)).size).toBe(PLANTED_RULES.length);
    expect(PLANTED_RULES.find((rule) => rule.id === "af-stroke")?.planted).toBe("direct");
    expect(PLANTED_RULES.find((rule) => rule.id === "af-dementia")?.planted).toBe("none");
  });
});

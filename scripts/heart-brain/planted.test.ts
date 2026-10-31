import { describe, expect, test } from "bun:test";

import { agreementOf, PLANTED_RULES } from "./planted";

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

import { describe, expect, test } from "bun:test";

import { recoveredOf } from "./verdict";

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

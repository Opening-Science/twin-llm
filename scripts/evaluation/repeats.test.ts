import { describe, expect, test } from "bun:test";

import { questionSchema } from "./question-set";
import { repeatsCell, withRepeats } from "./repeats";
import { refusalItem, trendItem } from "./score/fixtures";

/** Repeats per item (#304) on hand-written synthetic items. */

const ONCE = refusalItem("MIXED_UNITS");
const THRICE = trendItem({
  id: "Q-S1-02",
  repeat: 3,
  criteria: ["correctness", "consistency", "latency"],
});

describe("withRepeats", () => {
  test("null or undefined leaves the items as the set has them", () => {
    expect(withRepeats([ONCE, THRICE], null)).toEqual([ONCE, THRICE]);
    expect(withRepeats([ONCE, THRICE], undefined)).toEqual([ONCE, THRICE]);
  });

  test("raises every item to the minimum and never lowers one", () => {
    const [once, thrice] = withRepeats([ONCE, THRICE], 2);
    expect(once?.repeat).toBe(2);
    expect(thrice?.repeat).toBe(3);
    expect(thrice).toBe(THRICE);
  });

  test("a raised item is scored on consistency too, once", () => {
    const [once] = withRepeats([ONCE], 3);
    expect(ONCE.criteria.includes("consistency")).toBe(false);
    expect(once?.criteria.filter((each) => each === "consistency")).toEqual([
      "consistency",
    ]);
    // The raised copy passes the question set's own rule: consistency items repeat.
    expect(() => questionSchema.parse(once)).not.toThrow();
  });
});

describe("repeatsCell", () => {
  test("one count, a range, or a dash", () => {
    expect(repeatsCell([ONCE])).toBe("1");
    expect(repeatsCell([ONCE, THRICE])).toBe("1–3");
    expect(repeatsCell([])).toBe("—");
  });
});

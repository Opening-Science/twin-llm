import { describe, expect, test } from "bun:test";

import { type KeyEntry } from "../question-set";

import { keyHoldsNoValue } from "./turn";

const entry = (
  name: string,
  value: KeyEntry["value"],
  refusal: string | null,
): KeyEntry => ({
  name,
  tool: "cohort_event_rates",
  args: {},
  path: refusal === null ? "verdict" : "code",
  value,
  unit: null,
  n: 0,
  windows: [],
  refusal,
});

describe("keyHoldsNoValue", () => {
  test("a null or a refusal holds no value; a number or a verdict phrase does", () => {
    const entries = [
      entry("verdict", "raised", null),
      entry("ratio", 3.1, null),
      entry("empty", null, null),
      entry("refusal", "DESIGN_NOT_SUPPORTED", "DESIGN_NOT_SUPPORTED"),
    ];
    expect(keyHoldsNoValue(entries).map((row) => row.name)).toEqual(["empty", "refusal"]);
  });
});

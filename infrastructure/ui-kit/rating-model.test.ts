import { describe, expect, test } from "bun:test";

import { DEFAULT_RATING_LABELS, ratingKey, ratingText } from "./rating-model";

describe("ratingKey", () => {
  const cases: readonly [string, number | null, number | null | undefined][] = [
    ["ArrowRight", 3, 4],
    ["ArrowUp", 5, 5],
    ["ArrowRight", null, 1],
    ["ArrowLeft", 3, 2],
    ["ArrowDown", 1, 1],
    ["ArrowLeft", null, 1],
    ["Home", 4, 1],
    ["End", 2, 5],
    ["Backspace", 3, null],
    ["Delete", 3, null],
    ["Tab", 3, undefined],
    ["a", null, undefined],
  ];
  test.each(cases)("%s from %p gives %p", (key, value, next) => {
    expect(ratingKey(key, value, 5)).toBe(next);
  });
});

describe("ratingText", () => {
  test("names the value and its label, or says it is not rated", () => {
    expect(ratingText(4, DEFAULT_RATING_LABELS)).toBe("4 of 5: Very good");
    expect(ratingText(null, DEFAULT_RATING_LABELS)).toBe("Not rated");
  });
});

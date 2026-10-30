import { describe, expect, test } from "bun:test";

import { cha2ds2Vasc, scoreGroup } from "./cha2ds2-vasc";

const none = {
  ageYears: 50,
  female: false,
  heartFailure: false,
  hypertension: false,
  diabetes: false,
  strokeOrTia: false,
  vascularDisease: false,
};

describe("cha2ds2Vasc", () => {
  test("a man under 65 with nothing scores 0", () => {
    expect(cha2ds2Vasc(none)).toBe(0);
  });

  test("age bands: 64 is 0, 65 and 74 are 1, 75 is 2", () => {
    expect(cha2ds2Vasc({ ...none, ageYears: 64.9 })).toBe(0);
    expect(cha2ds2Vasc({ ...none, ageYears: 65 })).toBe(1);
    expect(cha2ds2Vasc({ ...none, ageYears: 74.99 })).toBe(1);
    expect(cha2ds2Vasc({ ...none, ageYears: 75 })).toBe(2);
  });

  test("each item adds its weight", () => {
    expect(cha2ds2Vasc({ ...none, female: true })).toBe(1);
    expect(cha2ds2Vasc({ ...none, heartFailure: true })).toBe(1);
    expect(cha2ds2Vasc({ ...none, hypertension: true })).toBe(1);
    expect(cha2ds2Vasc({ ...none, diabetes: true })).toBe(1);
    expect(cha2ds2Vasc({ ...none, strokeOrTia: true })).toBe(2);
    expect(cha2ds2Vasc({ ...none, vascularDisease: true })).toBe(1);
  });

  test("everything at once is the maximum, 9", () => {
    expect(
      cha2ds2Vasc({
        ageYears: 80,
        female: true,
        heartFailure: true,
        hypertension: true,
        diabetes: true,
        strokeOrTia: true,
        vascularDisease: true,
      }),
    ).toBe(9);
  });
});

describe("scoreGroup", () => {
  test("groups scores into four bands", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(scoreGroup)).toEqual([
      "0-1",
      "0-1",
      "2-3",
      "2-3",
      "4-5",
      "4-5",
      "6-9",
      "6-9",
    ]);
  });
});

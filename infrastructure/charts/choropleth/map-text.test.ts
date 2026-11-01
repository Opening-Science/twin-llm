import { describe, expect, test } from "bun:test";

import {
  betterDirection,
  binText,
  directionText,
  intervalText,
  regionLabel,
  uiText,
  valueText,
} from "./map-text";

describe("valueText", () => {
  test("adds the unit, attaching a percent sign", () => {
    expect(valueText(1234.56, "per 100,000", 1)).toBe("1,234.6 per 100,000");
    expect(valueText(4.25, "%", 1)).toBe("4.3%");
    expect(valueText(4.25, null, 2)).toBe("4.25");
  });
});

describe("intervalText and uiText", () => {
  test("write both bounds or nothing", () => {
    expect(intervalText(1.2, 3.45, 1)).toBe("1.2 to 3.5");
    expect(uiText(1.2, 3.45, 1)).toBe("95% UI 1.2 to 3.5");
    expect(uiText(null, 3, 1)).toBeNull();
    expect(intervalText(1, null, 1)).toBeNull();
  });
});

describe("regionLabel", () => {
  test("names the place, its rank, value and interval", () => {
    expect(
      regionLabel(
        { code: "NG-LA", name: "Lagos", value: 12.34, lower: 10.1, upper: 14.2, rank: 1 },
        37,
        "%",
        1,
      ),
    ).toBe("Lagos, rank 1 of 37: 12.3%, 95% UI 10.1 to 14.2");
    expect(
      regionLabel(
        { code: "NGA", name: "Nigeria", value: 3, lower: null, upper: null, rank: 2 },
        2,
        null,
        0,
      ),
    ).toBe("Nigeria, rank 2 of 2: 3");
  });
});

describe("binText", () => {
  test("one number when both ends round the same", () => {
    expect(binText(1.01, 1.04, 1)).toBe("1.0");
    expect(binText(1, 2, 0)).toBe("1 to 2");
  });
});

describe("directionText (#394)", () => {
  test("HALE and life expectancy: higher is better", () => {
    expect(betterDirection("hale")).toBe("higher");
    expect(directionText("life_expectancy")).toBe(
      "Stronger colour is higher; higher is better",
    );
  });

  test("burden measures: lower is better", () => {
    expect(betterDirection("Deaths")).toBe("lower");
    expect(directionText("dalys")).toBe("Stronger colour is higher; lower is better");
  });

  test("an unknown measure says only the scale", () => {
    expect(betterDirection("sdi")).toBeNull();
    expect(directionText("sdi")).toBe("Stronger colour is higher");
  });
});

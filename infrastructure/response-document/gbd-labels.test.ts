import { describe, expect, test } from "bun:test";

import { formatGbdRow, gbdAttributionFor } from "./gbd-labels";

const base = {
  measure: "deaths",
  cause: "Cardiovascular diseases",
  location: "Switzerland",
  year: "2021",
  sex: "both",
  age: "all_ages",
  value: 12.5,
  lower: 10,
  upper: 15,
  unit: "rate",
} as const;

describe("formatGbdRow", () => {
  test("maps codes to plain labels and shows the interval", () => {
    expect(formatGbdRow(base)).toBe(
      "Deaths · Cardiovascular diseases · Switzerland · 2021 · Both sexes · All ages · 12.5 per 100,000 (uncertainty interval 10–15)",
    );
  });

  test("labels every measure, sex and age code", () => {
    expect(
      formatGbdRow({ ...base, measure: "dalys", sex: "female", age: "age_standardized" }),
    ).toBe(
      "Disability-adjusted life years (DALYs) · Cardiovascular diseases · Switzerland · 2021 · Female · Age-standardised · 12.5 per 100,000 (uncertainty interval 10–15)",
    );
    expect(formatGbdRow({ ...base, measure: "yld", sex: "male" })).toBe(
      "Years lived with disability (YLDs) · Cardiovascular diseases · Switzerland · 2021 · Male · All ages · 12.5 per 100,000 (uncertainty interval 10–15)",
    );
    expect(formatGbdRow({ ...base, measure: "yll" })).toContain(
      "Years of life lost (YLLs) · ",
    );
    expect(formatGbdRow({ ...base, measure: "prevalence" })).toContain("Prevalence · ");
    expect(formatGbdRow({ ...base, measure: "incidence" })).toContain("Incidence · ");
  });

  test("metric codes: number and percent", () => {
    expect(formatGbdRow({ ...base, unit: "number", lower: null, upper: null })).toBe(
      "Deaths · Cardiovascular diseases · Switzerland · 2021 · Both sexes · All ages · 12.5 people",
    );
    expect(
      formatGbdRow({ ...base, unit: "percent", value: 3.2, lower: 2.9, upper: 3.6 }),
    ).toBe(
      "Deaths · Cardiovascular diseases · Switzerland · 2021 · Both sexes · All ages · 3.2% (uncertainty interval 2.9–3.6)",
    );
  });

  test("no interval when a bound is missing; unknown unit shown as given; empty unit omitted", () => {
    expect(formatGbdRow({ ...base, unit: "per 100,000", upper: null })).toBe(
      "Deaths · Cardiovascular diseases · Switzerland · 2021 · Both sexes · All ages · 12.5 per 100,000",
    );
    expect(formatGbdRow({ ...base, unit: "", lower: null, upper: null })).toBe(
      "Deaths · Cardiovascular diseases · Switzerland · 2021 · Both sexes · All ages · 12.5",
    );
  });
});

describe("gbdAttributionFor", () => {
  test("names the round all rows share, else the remote connector's line", () => {
    expect(
      gbdAttributionFor([{ source: "IHME GBD 2023" }, { source: "IHME GBD 2023" }]),
    ).toBe("Population estimate (IHME GBD 2023), not a statement about this person.");
    expect(gbdAttributionFor([{ source: "IHME GBD 2021" }])).toBe(
      "Population estimate (IHME GBD 2021), not a statement about this person.",
    );
    expect(
      gbdAttributionFor([{ source: "IHME GBD 2021" }, { source: "IHME GBD 2023" }]),
    ).toBe("Population estimate (IHME GBD 2021), not a statement about this person.");
  });
});

import { describe, expect, test } from "bun:test";

import {
  isSpecialtyId,
  literatureSource,
  SPECIALTY_IDS,
  specialtySearchTerm,
} from "./specialties";

describe("specialties", () => {
  test("lists the six agent specialties", () => {
    expect(SPECIALTY_IDS).toEqual([
      "gp",
      "diet",
      "anatomy",
      "sleep",
      "trainer",
      "genetics",
    ]);
  });

  test("isSpecialtyId accepts known ids only", () => {
    expect(isSpecialtyId("diet")).toBe(true);
    expect(isSpecialtyId("Diet")).toBe(false);
    expect(isSpecialtyId("cardiology")).toBe(false);
  });

  test("literatureSource tags the guideline source", () => {
    expect(literatureSource("sleep")).toBe("literature:sleep");
  });

  test("specialtySearchTerm limits to open access", () => {
    expect(specialtySearchTerm("anatomy")).toBe(
      '("anatomy"[mesh]) AND "open access"[filter]',
    );
    expect(specialtySearchTerm("diet", '"fibre"[tiab]')).toBe(
      '("fibre"[tiab]) AND "open access"[filter]',
    );
  });
});

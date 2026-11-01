import { describe, expect, test } from "bun:test";

import type { LocationIndex } from "../../infrastructure/charts/choropleth/match-location";

import {
  countryReport,
  matchUnit,
  renderReport,
  unitsOf,
  unmatchedReason,
} from "./match-rate";

/** A made-up index in the committed layout. */
const INDEX: LocationIndex = {
  version: "test",
  countries: [],
  states: [
    { code: "AA-1", country: "AAA", name: "North", names: ["North", "Upper"] },
    { code: "AA-2", country: "AAA", name: "South", names: ["South"] },
    { code: "BB-1", country: "BBB", name: "North", names: ["North"] },
  ],
};

const unit = (name: string, iso3166_2: string | null = null, iso3 = "AAA") => ({
  id: 1,
  level: 4,
  name,
  iso3,
  iso3166_2,
});

describe("matchUnit", () => {
  test("by code first, then the boundary's name, then its other names", () => {
    expect(matchUnit(INDEX, unit("Anything", "AA-2"))).toMatchObject({
      how: "code",
      code: "AA-2",
    });
    expect(matchUnit(INDEX, unit("north"))).toMatchObject({ how: "name", code: "AA-1" });
    expect(matchUnit(INDEX, unit("Upper"))).toMatchObject({
      how: "other name",
      code: "AA-1",
    });
    expect(matchUnit(INDEX, unit("East"))).toMatchObject({ how: "none", code: null });
  });

  test("only among the unit's own country", () => {
    expect(matchUnit(INDEX, unit("North", null, "BBB"))).toMatchObject({ code: "BB-1" });
    expect(matchUnit(INDEX, unit("South", null, "BBB")).how).toBe("none");
  });
});

describe("countryReport", () => {
  test("counts each way and lists boundaries two units share", () => {
    const report = countryReport(INDEX, "AAA", [
      unit("North"),
      unit("Upper"),
      unit("South", "AA-2"),
      unit("East"),
    ]);
    expect(report).toMatchObject({ units: 4, byCode: 1, byName: 1, byOtherName: 1 });
    expect(report.unmatched.map((match) => match.name)).toEqual(["East"]);
    expect(report.shared).toEqual([{ code: "AA-1", names: ["North", "Upper"] }]);
    expect(renderReport([report])).toContain("| AAA | 4 | 1 | 1 | 1 | 1 | 75% |");
  });
});

describe("unitsOf", () => {
  test("subnational rows of one alpha-3 only", () => {
    expect(
      unitsOf(
        [
          [1, null, 3, "Country", "AAA", null],
          [2, 1, 4, "State", "AAA", "AA-1"],
          [3, 2, 5, "Town", "AAA", null],
          [4, null, 4, "Elsewhere", "BBB", null],
        ],
        "AAA",
      ).map((entry) => entry.name),
    ).toEqual(["State", "Town"]);
  });
});

describe("unmatchedReason", () => {
  test("reads the reviewed list", () => {
    expect(unmatchedReason("NZL", "New Zealand Maori population")).toContain(
      "population group",
    );
    expect(unmatchedReason("NZL", "Auckland")).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";

import { applyCountryRules, reserveGbdNames, type StateUnit } from "./apply-rules";
import type { Ring } from "./shapefile";

const square = (x: number): Ring => [
  [x, 0],
  [x, 1],
  [x + 1, 1],
  [x + 1, 0],
  [x, 0],
];

/** Made-up units in the shape the build reads from Natural Earth. */
const unit = (
  country: string,
  code: string,
  name: string,
  x: number,
  fields: Record<string, string> = {},
  names: readonly string[] = [name],
): StateUnit => ({ country, code, name, names, rings: [square(x)], fields });

const ALL: readonly StateUnit[] = [
  unit("AAA", "AA-1", "One", 0, { region: "R1" }),
  unit("AAA", "AA-2", "Two", 1, { region: "R1" }),
  unit("AAA", "AA-3", "Three", 2, { region: "R2" }),
  unit("AAA", "AA-OLD", "Four", 3),
  unit("AAA", "AA-9", "Nine", 4),
  unit("AAA", "AA-9", "Ten", 5),
  unit("BBB", "AA-5", "Borrowed", 6),
];

describe("applyCountryRules", () => {
  test("no rules keeps the country's units as they are", () => {
    expect(applyCountryRules("AAA", {}, ALL)).toEqual(
      ALL.filter((state) => state.country === "AAA"),
    );
  });

  test("dissolves by field in place of the first member, with one outline", () => {
    const out = applyCountryRules(
      "AAA",
      {
        dissolve: [
          {
            code: "AA-R1",
            name: "Region one",
            members: { field: "region", value: "R1" },
          },
        ],
      },
      ALL,
    );
    expect(out.map((state) => state.code)).toEqual([
      "AA-R1",
      "AA-3",
      "AA-OLD",
      "AA-9",
      "AA-9",
    ]);
    expect(out[0]?.rings).toHaveLength(1);
    expect(out[0]?.names).toEqual(["Region one"]);
  });

  test("dissolves by code list and leaves out the exceptions", () => {
    const out = applyCountryRules(
      "AAA",
      {
        dissolve: [
          {
            code: "GBD-1",
            name: "All but three",
            members: { field: "region", value: "R1", except: ["AA-2"] },
            names: ["Other"],
          },
        ],
      },
      ALL,
    );
    expect(out.map((state) => state.code)).toEqual([
      "GBD-1",
      "AA-2",
      "AA-3",
      "AA-OLD",
      "AA-9",
      "AA-9",
    ]);
    expect(out[0]?.names).toEqual(["All but three", "Other"]);
  });

  test("borrows a unit filed under another country", () => {
    const out = applyCountryRules("AAA", { borrow: ["AA-5"] }, ALL);
    expect(out.at(-1)).toMatchObject({ country: "AAA", code: "AA-5", name: "Borrowed" });
  });

  test("recodes by code, or by code and name where a code repeats, and renames", () => {
    const out = applyCountryRules(
      "AAA",
      {
        recode: { "AA-OLD": "AA-4", "AA-9|Ten": "AA-10" },
        rename: { "AA-1": "Uno" },
      },
      ALL,
    );
    expect(out.map((state) => [state.code, state.name])).toEqual([
      ["AA-1", "Uno"],
      ["AA-2", "Two"],
      ["AA-3", "Three"],
      ["AA-4", "Four"],
      ["AA-9", "Nine"],
      ["AA-10", "Ten"],
    ]);
    expect(out[0]?.names).toEqual(["Uno"]);
  });

  test("adds an alias to the unit it names", () => {
    const out = applyCountryRules("AAA", { aliases: { "Three, City of": "AA-3" } }, ALL);
    expect(out[2]?.names).toEqual(["Three", "Three, City of"]);
  });

  test("a rule that names nothing stops the build", () => {
    expect(() => applyCountryRules("AAA", { recode: { "AA-X": "AA-Y" } }, ALL)).toThrow(
      "unused rules AA-X",
    );
    expect(() => applyCountryRules("AAA", { rename: { "AA-X": "Y" } }, ALL)).toThrow(
      "unused rules AA-X",
    );
    expect(() =>
      applyCountryRules(
        "AAA",
        { dissolve: [{ code: "G", name: "G", members: ["AA-X"] }] },
        ALL,
      ),
    ).toThrow("G has no members");
    expect(() => applyCountryRules("AAA", { borrow: ["AA-X"] }, ALL)).toThrow(
      "nothing to borrow",
    );
    expect(() => applyCountryRules("AAA", { aliases: { Y: "AA-X" } }, ALL)).toThrow(
      "alias Y names no unit",
    );
  });
});

describe("reserveGbdNames", () => {
  const units: readonly StateUnit[] = [
    unit("AAA", "AA-1", "Hampshire", 0, {}, ["Hampshire", "Southampton", "Hants"]),
    unit("AAA", "AA-2", "Southampton", 1),
    unit("AAA", "AA-3", "Wandsworth", 2, {}, ["Wandsworth", "Greater London"]),
    unit("AAA", "AA-4", "Durham", 3, {}, ["Durham", "County Durham"]),
  ];

  test("a GBD name leaves every unit but its own", () => {
    const out = reserveGbdNames(
      units,
      [
        { name: "Southampton", iso3166_2: null },
        { name: "Greater London", iso3166_2: null },
        { name: "County Durham", iso3166_2: null },
      ],
      { "County Durham": "AA-4" },
    );
    expect(out.map((state) => state.names)).toEqual([
      ["Hampshire", "Hants"],
      ["Southampton"],
      ["Wandsworth"],
      ["Durham", "County Durham"],
    ]);
  });

  test("an ISO code decides before a name", () => {
    const out = reserveGbdNames(units, [{ name: "Southampton", iso3166_2: "AA-1" }]);
    expect(out[0]?.names).toContain("Southampton");
    expect(out[1]?.names).toEqual(["Southampton"]);
  });
});

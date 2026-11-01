import { describe, expect, test } from "bun:test";

import { buildLocations } from "./build-location-map";

/** A made-up slice in the layout of IHME's location metadata file. */
const META = [
  "location_name,location_id,ihme_loc_id,level,region_name,super_region_name",
  "Global,1,G,0,,",
  "High-income,64,S1,1,,High-income",
  "High-income North America,100,R16,2,High-income North America,High-income",
  "United States of America,102,USA,3,High-income North America,High-income",
  "Alabama,523,USA_523,4,High-income North America,High-income",
  '"Made-up County, North",999001,USA_999001,4,High-income North America,High-income',
].join("\n");

describe("buildLocations", () => {
  test("parents from the sort order, ISO codes from ihme_loc_id and the hand table", () => {
    expect(buildLocations(META)).toEqual([
      { id: 1, parentId: null, level: 0, name: "Global", iso3: null, iso31662: null },
      { id: 64, parentId: 1, level: 1, name: "High-income", iso3: null, iso31662: null },
      {
        id: 100,
        parentId: 64,
        level: 2,
        name: "High-income North America",
        iso3: null,
        iso31662: null,
      },
      {
        id: 102,
        parentId: 100,
        level: 3,
        name: "United States of America",
        iso3: "USA",
        iso31662: null,
      },
      {
        id: 523,
        parentId: 102,
        level: 4,
        name: "Alabama",
        iso3: "USA",
        iso31662: "US-AL",
      },
      {
        id: 999001,
        parentId: 102,
        level: 4,
        name: "Made-up County, North",
        iso3: "USA",
        iso31662: null,
      },
    ]);
  });

  test("a unit that does not sit under its own country stops the build", () => {
    expect(() =>
      buildLocations(
        [
          "location_name,location_id,ihme_loc_id,level",
          "Global,1,G,0",
          "R,2,R1,1",
          "Reg,3,R2,2",
          "Canada,101,CAN,3",
          "Alabama,523,USA_523,4",
        ].join("\n"),
      ),
    ).toThrow("Alabama does not sit under its country");
  });
});

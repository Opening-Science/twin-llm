import { describe, expect, test } from "bun:test";

import { anchorLayer, type AnchorLayer } from "./anchor-layer";
import { biomarkerById, listBiomarkers, referenceIntervalFor } from "./catalogue";
import { parsePopulation, type PopulationContext } from "./population";

describe("population keys", () => {
  test("every population in the pinned layer parses", () => {
    const unparsed = anchorLayer.referenceIntervals
      .filter((interval) => parsePopulation(interval.population) === null)
      .map((interval) => interval.population);
    expect(unparsed).toEqual([]);
  });

  test.each([
    ["general_adult", { sex: null, age: null, qualifier: null }],
    ["male", { sex: "male", age: null, qualifier: null }],
    ["female_Follikelphase", { sex: "female", age: null, qualifier: "follicular" }],
    [
      "age_>18J_male",
      { sex: "male", age: { min: 18, minInclusive: false, max: null }, qualifier: null },
    ],
    [
      "age_12-60J",
      { sex: null, age: { min: 12, minInclusive: true, max: 60 }, qualifier: null },
    ],
    ["time_vor_10h", { sex: null, age: null, qualifier: "before-10h" }],
    ["time_nach_17h", { sex: null, age: null, qualifier: "after-17h" }],
    ["fasting_adult", { sex: null, age: null, qualifier: "fasting" }],
  ])("%s", (key, expected) => {
    expect(parsePopulation(key)).toEqual(expected as ReturnType<typeof parsePopulation>);
  });

  test.each([
    "pregnant",
    "male_male",
    "age_adult",
    "time_vor_9h",
    "fasting_Follikelphase",
  ])("unknown or doubled token %s matches nobody", (key) => {
    expect(parsePopulation(key)).toBeNull();
  });
});

describe("referenceIntervalFor", () => {
  test.each<[string, string, PopulationContext, string | null]>([
    ["Ferritin, male 40", "BM-107", { sex: "male", ageYears: 40 }, "RI-044"],
    ["Ferritin, female", "BM-107", { sex: "female" }, "RI-045"],
    ["Ferritin, male without age", "BM-107", { sex: "male" }, null],
    ["Ferritin, no context", "BM-107", {}, null],
    ["Glukose, fasting not known", "BM-128", { sex: "male", ageYears: 40 }, null],
    ["Glukose, fasting", "BM-128", { qualifiers: ["fasting"] }, "RI-062"],
    ["DHEA-S, male 34 sits in two bands", "BM-087", { sex: "male", ageYears: 34 }, null],
    ["DHEA-S, male 30", "BM-087", { sex: "male", ageYears: 30 }, "RI-036"],
    ["Cortisol, before 10h", "BM-077", { qualifiers: ["before-10h"] }, "RI-029"],
    ["Cortisol, time not known", "BM-077", {}, null],
    ["Östradiol, female outside a known phase", "BM-001", { sex: "female" }, null],
    [
      "Östradiol, female follicular",
      "BM-001",
      { sex: "female", qualifiers: ["follicular"] },
      "RI-002",
    ],
    ["FT4, age 18 is not >19", "BM-115", { ageYears: 18 }, null],
    ["FT4, age 20", "BM-115", { ageYears: 20 }, "RI-052"],
    ["Calcium, age 60 is inside 12-60", "BM-063", { ageYears: 60 }, "RI-019"],
    ["Calcium, age 61", "BM-063", { ageYears: 61 }, null],
    ["Kalium, general adult", "BM-177", {}, "RI-075"],
    ["LDL has bands only", "BM-190", { sex: "male", ageYears: 40 }, null],
    ["Zink has no interval", "BM-411", { sex: "male", ageYears: 40 }, null],
  ])("%s", (_name, id, context, expected) => {
    expect(referenceIntervalFor(id, context)?.id ?? null).toBe(expected);
  });

  test("an unparseable population matches nobody, even with a full context", () => {
    const layer: AnchorLayer = {
      ...anchorLayer,
      referenceIntervals: [
        {
          ...anchorLayer.referenceIntervals.find((i) => i.id === "RI-075")!,
          population: "pregnant",
        },
      ],
    };
    expect(
      referenceIntervalFor("BM-177", { sex: "female", ageYears: 30 }, layer),
    ).toBeNull();
  });
});

describe("catalogue lookups", () => {
  test("listBiomarkers is sorted by id", () => {
    const ids = listBiomarkers().map((marker) => marker.id);
    expect(ids[0]).toBe("BM-001");
    expect(ids.at(-1)).toBe("BM-436");
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  test("biomarkerById", () => {
    expect(biomarkerById("BM-386")?.nameDe).toBe("TSH");
    expect(biomarkerById("BM-999")).toBeNull();
  });
});

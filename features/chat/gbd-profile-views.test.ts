import { describe, expect, test } from "bun:test";

import { toChatView } from "@/infrastructure/chat-view";
import { LOCATION_INDEX } from "@/infrastructure/charts/choropleth/match-location";
import {
  assembleLocationProfile,
  type GbdProfile,
  locationHeadlineInputs,
  mapInputs,
  type ProfileCall,
} from "@/packages/gbd-local/profile";
import type { GbdEstimateResult } from "@/packages/query-tools/gbd-estimate";
import type { GbdEstimateInput } from "@/packages/query-tools/gbd-estimate-schema";
import { gbdNoEstimate } from "@/packages/query-tools/gbd-refusals";

import {
  overviewView,
  profileMapSpec,
  profileModelNote,
  profileTitle,
  profileViews,
  sectionView,
  tableValue,
} from "./gbd-profile-views";

/**
 * The views of a `gbd_profile` (#403) over MADE-UP results: the values are
 * invented for the test and are not IHME estimates.
 */

const SWITZERLAND = { id: 94, name: "Switzerland", parentId: 73 };

const PLACES: Readonly<Record<number, Readonly<[string, string | null]>>> = {
  94: ["Switzerland", "CHE"],
  81: ["Germany", "DEU"],
  73: ["Western Europe", null],
  1: ["Global", null],
};

const call = (
  input: GbdEstimateInput,
  rows: readonly Readonly<[number, number, number]>[],
  auditIds: readonly string[],
): ProfileCall => {
  const result: GbdEstimateResult = {
    attribution:
      "Population estimate (IHME GBD 2023), not a statement about this person.",
    source: "IHME GBD 2023",
    measure: input.measure,
    metric: input.metric,
    unit: "years",
    sex: input.sex,
    age: input.age,
    cause: null,
    risk: null,
    n: rows.length,
    rows: rows.map(([id, year, value]) => ({
      location: PLACES[id]?.[0] ?? `id ${id}`,
      location_id: id,
      iso3: PLACES[id]?.[1] ?? null,
      iso3166_2: null,
      year,
      value,
      lower: value - 2.125,
      upper: value + 2.125,
    })),
    not_imported: [],
  };
  return { input, result, auditIds };
};

const { hale, lifeExpectancy } = locationHeadlineInputs(SWITZERLAND);

const PROFILE: GbdProfile = assembleLocationProfile({
  place: SWITZERLAND,
  hale: call(
    hale,
    [
      [94, 2023, 70.25],
      [73, 2023, 68.55],
      [1, 2023, 61.75],
    ],
    ["21"],
  ),
  lifeExpectancy: {
    input: lifeExpectancy,
    result: gbdNoEstimate("life expectancy"),
    auditIds: ["22"],
  },
  year: 2023,
  causes: { names: [], total: 0 },
  dalys: [],
  map: call(
    mapInputs(SWITZERLAND, 2023)[1]!,
    [
      [94, 2023, 70.25],
      [81, 2023, 68.75],
    ],
    ["23"],
  ),
});

describe("profile tables", () => {
  test("round years and rates to one decimal and counts to whole numbers", () => {
    expect(tableValue(71.58506727433848, "years")).toBe(71.6);
    expect(tableValue(34703.63518658286, "per 100,000")).toBe(34703.6);
    expect(tableValue(60043088.86, "number")).toBe(60043089);
  });

  test("the title names the kind, subject and year", () => {
    expect(profileTitle(PROFILE)).toBe("Location profile: Switzerland, 2023");
    expect(
      profileTitle({ ...PROFILE, kind: "cause", subject: "Asthma", year: null }),
    ).toBe("Cause profile: Asthma");
  });

  test("the sections table lists every section and what is not imported", () => {
    const view = overviewView(PROFILE);
    expect(view).not.toBeNull();
    expect(toChatView(view)).toEqual(view);
    expect(view?.id).toBe("view-21-22-23-profile");
    expect(view?.sourceAuditIds).toEqual(["21", "22", "23"]);
    if (view?.kind !== "table") throw new Error("not a table");
    expect(view.spec.rows.map((row) => [row.status, row.note])).toEqual([
      ["Shown", null],
      ["Not imported", "Life expectancy at birth for Switzerland is not imported."],
      ["Not imported", "Only 2023 is imported for Switzerland, so there is no trend."],
      [
        "Not imported",
        "No causes other than All causes are imported, so top causes of DALYs are not shown.",
      ],
      ["Shown", null],
    ]);
    expect(overviewView({ ...PROFILE, sections: [] })).toBeNull();
  });

  test("a shown section is a table of its rows; a missing one draws nothing", () => {
    const [haleSection, lifeSection] = PROFILE.sections;
    const view = sectionView(haleSection!);
    if (view?.kind !== "table") throw new Error("not a table");
    expect(toChatView(view)).toEqual(view);
    expect(view.id).toBe("view-21-hale");
    expect(view.title).toBe(
      "Healthy life expectancy (HALE) at birth, 2023: Switzerland, its region and the world",
    );
    expect(view.spec.columns.map((column) => column.label)).toEqual([
      "Place",
      "Year",
      "Value (years)",
      "Lower (95% UI)",
      "Upper (95% UI)",
    ]);
    expect(view.spec.rows[0]).toEqual({
      year: "2023",
      label: "Switzerland",
      value: 70.3,
      lower: 68.1,
      upper: 72.4,
    });
    expect(view.spec.window).toEqual({ start: "2023-01-01", end: "2023-12-31" });
    expect(view.spec.subject).toBeNull();
    expect(sectionView(lifeSection!)).toBeNull();
    expect(sectionView({ ...haleSection!, auditIds: [] })).toBeNull();
  });

  test("a ranked section numbers its rows", () => {
    const view = sectionView({ ...PROFILE.sections[0]!, ranked: true });
    if (view?.kind !== "table") throw new Error("not a table");
    expect(view.spec.columns.map((column) => column.key)).toEqual([
      "rank",
      "label",
      "value",
      "lower",
      "upper",
    ]);
    expect(view.spec.rows.map((row) => row.rank)).toEqual([1, 2, 3]);
  });
});

describe("the profile map", () => {
  test("draws the place and its neighbours by country", () => {
    const built = profileMapSpec(LOCATION_INDEX, PROFILE);
    expect(built?.spec.level).toBe("region");
    expect(built?.spec.regions.map((region) => [region.code, region.value])).toEqual([
      ["CHE", 70.25],
      ["DEU", 68.75],
    ]);
    expect(built?.spec.label).toBe(
      "Healthy life expectancy (HALE), 2023, both sexes, at birth",
    );
    expect(profileMapSpec(LOCATION_INDEX, { ...PROFILE, map: null })).toBeNull();
  });

  test("every imported country is the world map", () => {
    const world = { ...PROFILE, map: { ...PROFILE.map!, world: true } };
    expect(profileMapSpec(LOCATION_INDEX, world)?.spec.level).toBe("world");
  });
});

describe("profileViews", () => {
  const built = profileMapSpec(LOCATION_INDEX, PROFILE)!;

  test("reading order: sections table, each shown section, the map in its place", () => {
    const views = profileViews(PROFILE, { built, auditIds: ["23", "24"] });
    expect(views.map((view) => [view.kind, view.id])).toEqual([
      ["table", "view-21-22-23-profile"],
      ["table", "view-21-hale"],
      ["map.choropleth", "view-23-24"],
    ]);
    expect(views.every((view) => toChatView(view) !== null)).toBe(true);
  });

  test("no map audit row, no map; a skill's views keep only their kinds", () => {
    expect(profileViews(PROFILE, null).map((view) => view.kind)).toEqual([
      "table",
      "table",
    ]);
    expect(
      profileViews(PROFILE, { built, auditIds: ["24"] }, ["map.choropleth"]).map(
        (view) => view.kind,
      ),
    ).toEqual(["map.choropleth"]);
  });

  test("the model reads each section's status, note and rounded rows", () => {
    const note = profileModelNote(PROFILE, profileViews(PROFILE, null));
    expect(note.profile).toBe("Location profile: Switzerland, 2023");
    expect(note.views_drawn).toBe(2);
    expect(note.sections[0]).toEqual({
      title:
        "Healthy life expectancy (HALE) at birth, 2023: Switzerland, its region and the world",
      status: "shown",
      unit: "years",
      rows: [
        { place: "Switzerland", year: 2023, value: 70.3 },
        { place: "Western Europe", year: 2023, value: 68.6 },
        { place: "Global", year: 2023, value: 61.8 },
      ],
    });
    expect(note.sections[1]).toEqual({
      title: "Life expectancy at birth, 2023: Switzerland, its region and the world",
      status: "not imported",
      note: "Life expectancy at birth for Switzerland is not imported.",
    });
  });
});

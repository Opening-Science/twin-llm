/**
 * The pure half of `gbd_profile` (#403): which `gbd_estimate` calls a
 * location or cause profile makes, in a fixed order, and how their results
 * become sections. No I/O; the calls, their audit rows and the views are in
 * features/chat/gbd-profile-tool.ts and gbd-profile-views.ts.
 *
 * Every number in a section is a row a call returned. A section whose
 * estimates are not imported says so in one plain sentence; it never fails
 * the profile. Living-well measures (HALE, life expectancy) come first;
 * deaths only when asked (docs/clinical-research.md).
 */
import type { GbdEstimateResult } from "@/packages/query-tools/gbd-estimate";
import type { GbdEstimateInput } from "@/packages/query-tools/gbd-estimate-schema";
import type { GbdRefusal } from "@/packages/query-tools/gbd-refusals";

import { GBD_LAST_YEAR, GBD_LOCAL_ATTRIBUTION } from "./constants";
import { GBD_GLOBAL_ID, type GbdNamed } from "./estimate-rows";

/** The years a profile asks for its trend; whichever are imported come back. */
export const PROFILE_YEARS: readonly number[] = [
  1990, 2000, 2010, 2015, 2019, 2020, 2021, 2022, 2023,
];

/** Causes a location profile ranks, by name; more are left out and said so. */
export const PROFILE_CAUSE_CAP = 40;

/** Rows of a ranked list. */
export const PROFILE_RANK_TOP = 10;

/** The cause GBD totals every other one under; never ranked against them. */
const ALL_CAUSES = "All causes";

export type ProfileKind = "location" | "cause";

export type ProfilePlace = Readonly<{
  id: number;
  name: string;
  parentId: number | null;
}>;

/** One call as the runner made it: its input, what it returned and its audit rows. */
export type ProfileCall = Readonly<{
  input: GbdEstimateInput;
  result: GbdEstimateResult | GbdRefusal;
  auditIds: readonly string[];
}>;

export const isEstimate = (
  result: GbdEstimateResult | GbdRefusal,
): result is GbdEstimateResult => "rows" in result;

export type ProfileRow = Readonly<{
  /** The place, cause, sex or measure the row is about. */
  label: string;
  year: number;
  value: number;
  lower: number | null;
  upper: number | null;
}>;

export type SectionId =
  | "hale"
  | "life_expectancy"
  | "trend"
  | "top_dalys"
  | "top_deaths"
  | "map"
  | "highest"
  | "by_sex"
  | "deaths_trend";

export type ProfileSection = Readonly<{
  id: SectionId;
  title: string;
  status: "shown" | "not_imported";
  /** One plain sentence: what is missing, or why the section is short. */
  note: string | null;
  /** What the first column names: Place, Cause, Sex or Measure. */
  rowLabel: string;
  unit: string | null;
  /** True when the rows are a ranking, largest first. */
  ranked: boolean;
  rows: readonly ProfileRow[];
  auditIds: readonly string[];
}>;

export type GbdProfile = Readonly<{
  kind: ProfileKind;
  subject: string;
  /** The latest year the profile found; null when nothing was. */
  year: number | null;
  attribution: string;
  sections: readonly ProfileSection[];
  /** The rows the map is drawn from, when any came back. */
  map: Readonly<{
    result: GbdEstimateResult;
    auditIds: readonly string[];
    /** True when the rows are every imported country, so the map is the world. */
    world: boolean;
  }> | null;
}>;

// ---------------------------------------------------------------- the plan

const at = (id: number): string => String(id);

/** The place, its parent (region, or country for a state) and the world, once each. */
export const comparisonIds = (place: ProfilePlace): readonly number[] => [
  ...new Set([
    place.id,
    ...(place.parentId === null ? [] : [place.parentId]),
    GBD_GLOBAL_ID,
  ]),
];

const lifeTable = (
  measure: "hale" | "life_expectancy",
  locations: readonly number[],
  years: readonly number[],
): GbdEstimateInput => ({
  measure,
  metric: "years",
  sex: "both",
  age: "at_birth",
  locations: locations.map(at),
  years: [...years],
});

/** Location profile, first two calls: HALE and life expectancy for every profile year. */
export const locationHeadlineInputs = (
  place: ProfilePlace,
): Readonly<{ hale: GbdEstimateInput; lifeExpectancy: GbdEstimateInput }> => ({
  hale: lifeTable("hale", comparisonIds(place), PROFILE_YEARS),
  lifeExpectancy: lifeTable("life_expectancy", comparisonIds(place), PROFILE_YEARS),
});

/** The latest year with a row for this place, else for any place; null when none. */
export const latestYear = (
  calls: readonly ProfileCall[],
  placeId: number | null,
): number | null => {
  const rows = calls.flatMap((call) => (isEstimate(call.result) ? call.result.rows : []));
  const own = placeId === null ? [] : rows.filter((row) => row.location_id === placeId);
  const years = (own.length > 0 ? own : rows).map((row) => row.year);
  return years.length === 0 ? null : Math.max(...years);
};

/** The causes a location profile ranks: imported, not All causes, by name, capped. */
export const rankableCauses = (
  causes: readonly GbdNamed[],
): Readonly<{ names: readonly string[]; total: number }> => {
  const names = [
    ...new Set(causes.map((cause) => cause.name).filter((name) => name !== ALL_CAUSES)),
  ].sort((a, b) => a.localeCompare(b, "en"));
  return { names: names.slice(0, PROFILE_CAUSE_CAP), total: names.length };
};

/** One call per cause: an age-standardised rate in one place and year. */
export const causeRateInputs = (
  measure: "dalys" | "deaths",
  placeId: number,
  year: number,
  causes: readonly string[],
): readonly GbdEstimateInput[] =>
  causes.map((cause) => ({
    measure,
    metric: "rate",
    cause,
    sex: "both",
    age: "age_standardized",
    locations: [at(placeId)],
    years: [year],
  }));

/** HALE at birth for the units inside the place, then for its neighbours. */
export const mapInputs = (
  place: ProfilePlace,
  year: number,
): readonly GbdEstimateInput[] =>
  [place.id, ...(place.parentId === null ? [] : [place.parentId])].map((id) => ({
    measure: "hale",
    metric: "years",
    sex: "both",
    age: "at_birth",
    children_of: at(id),
    years: [year],
  }));

/** Cause profile, first call: the world's DALY rate over the profile years, age-standardised then all ages. */
export const causeTrendInputs = (
  cause: string,
  measure: "dalys" | "deaths",
): readonly GbdEstimateInput[] =>
  (["age_standardized", "all_ages"] as const).map((age) => ({
    measure,
    metric: "rate",
    cause,
    sex: "both",
    age,
    locations: [at(GBD_GLOBAL_ID)],
    years: [...PROFILE_YEARS],
  }));

/** The age a cause profile reads, from the trend call that found rows; age-standardised by default. */
export const causeAge = (calls: readonly ProfileCall[]): GbdEstimateInput["age"] =>
  calls.find((call) => isEstimate(call.result))?.input.age ?? "age_standardized";

/** Every imported country in one year: where the cause is highest, and the map. */
export const causeHighestInput = (
  cause: string,
  age: GbdEstimateInput["age"],
  year: number,
): GbdEstimateInput => ({
  measure: "dalys",
  metric: "rate",
  cause,
  sex: "both",
  age,
  children_of: at(GBD_GLOBAL_ID),
  years: [year],
});

/** The world's rate for females and for males in one year. */
export const causeBySexInputs = (
  cause: string,
  age: GbdEstimateInput["age"],
  year: number,
): readonly GbdEstimateInput[] =>
  (["female", "male"] as const).map((sex) => ({
    measure: "dalys",
    metric: "rate",
    cause,
    sex,
    age,
    locations: [at(GBD_GLOBAL_ID)],
    years: [year],
  }));

/** The first call that found rows, else the last one tried; null when none ran. */
export const firstFound = (calls: readonly ProfileCall[]): ProfileCall | null =>
  calls.find((call) => isEstimate(call.result)) ?? calls.at(-1) ?? null;

// ------------------------------------------------------------ the assembly

const AGE_WORDS: Readonly<Record<GbdEstimateInput["age"], string>> = {
  at_birth: "at birth",
  age_standardized: "age-standardised",
  all_ages: "all ages",
};

const auditIdsOf = (calls: readonly (ProfileCall | null)[]): readonly string[] => [
  ...new Set(calls.flatMap((call) => call?.auditIds ?? [])),
];

const rowsOf = (call: ProfileCall | null): GbdEstimateResult["rows"] =>
  call !== null && isEstimate(call.result) ? call.result.rows : [];

const unitOf = (calls: readonly (ProfileCall | null)[]): string | null =>
  calls.flatMap((call) =>
    call !== null && isEstimate(call.result) ? [call.result.unit] : [],
  )[0] ?? null;

const toRow = (
  label: string,
  row: Readonly<{
    year: number;
    value: number;
    lower: number | null;
    upper: number | null;
  }>,
): ProfileRow => ({
  label,
  year: row.year,
  value: row.value,
  lower: row.lower,
  upper: row.upper,
});

const section = (
  fields: Omit<ProfileSection, "status" | "note" | "ranked"> &
    Partial<Pick<ProfileSection, "note" | "ranked">>,
  missing: string,
): ProfileSection => ({
  ...fields,
  ranked: fields.ranked ?? false,
  status: fields.rows.length === 0 ? "not_imported" : "shown",
  note: fields.rows.length === 0 ? missing : (fields.note ?? null),
});

/** `Western Europe and Global`. */
const andList = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;

/** The asked places with no row in this year, by name. */
const missingIn = (call: ProfileCall | null, year: number | null): readonly string[] =>
  call === null || !isEstimate(call.result) || year === null
    ? []
    : call.result.not_imported
        .filter((pair) => pair.year === year)
        .map((pair) => pair.location);

const lifeTableSection = (
  id: "hale" | "life_expectancy",
  measureName: string,
  place: ProfilePlace,
  call: ProfileCall | null,
  year: number | null,
): ProfileSection => {
  const rows = rowsOf(call).filter((row) => row.year === year);
  const missing = missingIn(call, year);
  return section(
    {
      id,
      title: `${measureName} at birth${year === null ? "" : `, ${year}`}: ${place.name}, its region and the world`,
      rowLabel: "Place",
      unit: unitOf([call]),
      rows: rows.map((row) => toRow(row.location, row)),
      auditIds: auditIdsOf([call]),
      note: missing.length === 0 ? null : `Not imported for ${andList(missing)}.`,
    },
    `${measureName} at birth for ${place.name} is not imported.`,
  );
};

const trendSection = (
  title: string,
  calls: readonly Readonly<{ label: string; call: ProfileCall | null }>[],
  placeId: number | null,
  subject: string,
): ProfileSection => {
  const rows = calls.flatMap(({ label, call }) =>
    rowsOf(call)
      .filter((row) => placeId === null || row.location_id === placeId)
      .map((row) => toRow(label, row)),
  );
  const years = new Set(rows.map((row) => row.year));
  const only = [...years][0];
  const ordered = [...rows].sort(
    (a, b) => a.label.localeCompare(b.label, "en") || a.year - b.year,
  );
  return section(
    {
      id: "trend",
      title,
      rowLabel: "Measure",
      unit: unitOf(calls.map(({ call }) => call)),
      rows: years.size < 2 ? [] : ordered,
      auditIds: auditIdsOf(calls.map(({ call }) => call)),
    },
    only === undefined
      ? `No estimates over time for ${subject} are imported, so there is no trend.`
      : `Only ${only} is imported for ${subject}, so there is no trend.`,
  );
};

/** Largest first, then by label; the top `PROFILE_RANK_TOP`. */
const ranking = (rows: readonly ProfileRow[]): readonly ProfileRow[] =>
  [...rows]
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "en"))
    .slice(0, PROFILE_RANK_TOP);

const causeRankSection = (
  id: "top_dalys" | "top_deaths",
  measureName: string,
  place: ProfilePlace,
  year: number | null,
  causeCalls: readonly ProfileCall[],
  causes: Readonly<{ names: readonly string[]; total: number }>,
): ProfileSection => {
  const rows = causeCalls.flatMap((call) =>
    rowsOf(call).map((row) =>
      toRow(isEstimate(call.result) ? (call.result.cause ?? "") : "", row),
    ),
  );
  const cut =
    causes.total > causes.names.length
      ? `Ranked among the first ${causes.names.length} of ${causes.total} imported causes by name.`
      : null;
  return section(
    {
      id,
      title: `Top causes of ${measureName}${year === null ? "" : `, ${year}`}: ${place.name}, rate per 100,000, age-standardised`,
      rowLabel: "Cause",
      unit: unitOf(causeCalls),
      ranked: true,
      rows: ranking(rows),
      auditIds: auditIdsOf(causeCalls),
      note: cut,
    },
    causes.names.length === 0
      ? `No causes other than All causes are imported, so top causes of ${measureName} are not shown.`
      : `Age-standardised ${id === "top_dalys" ? "DALY" : "death"} rates by cause for ${place.name}${year === null ? "" : ` in ${year}`} are not imported.`,
  );
};

const mapSection = (
  call: ProfileCall | null,
  title: string,
  missing: string,
): ProfileSection =>
  section(
    {
      id: "map",
      title,
      rowLabel: "Place",
      unit: unitOf([call]),
      rows: rowsOf(call).map((row) => toRow(row.location, row)),
      auditIds: auditIdsOf([call]),
    },
    missing,
  );

const mapOf = (call: ProfileCall | null): GbdProfile["map"] =>
  call !== null && isEstimate(call.result)
    ? {
        result: call.result,
        auditIds: call.auditIds,
        world: call.input.children_of === at(GBD_GLOBAL_ID),
      }
    : null;

export type LocationCalls = Readonly<{
  place: ProfilePlace;
  hale: ProfileCall | null;
  lifeExpectancy: ProfileCall | null;
  year: number | null;
  causes: Readonly<{ names: readonly string[]; total: number }>;
  dalys: readonly ProfileCall[];
  /** Left out unless deaths were asked for. */
  deaths?: readonly ProfileCall[];
  map: ProfileCall | null;
}>;

/** A location profile: HALE, life expectancy, trend, top causes of DALYs, map; deaths when asked. Pure. */
export const assembleLocationProfile = (calls: LocationCalls): GbdProfile => {
  const { place, year } = calls;
  const sections: ProfileSection[] = [
    lifeTableSection("hale", "Healthy life expectancy (HALE)", place, calls.hale, year),
    lifeTableSection(
      "life_expectancy",
      "Life expectancy",
      place,
      calls.lifeExpectancy,
      year,
    ),
    trendSection(
      `${place.name} over time: HALE and life expectancy at birth`,
      [
        { label: "HALE", call: calls.hale },
        { label: "Life expectancy", call: calls.lifeExpectancy },
      ],
      place.id,
      place.name,
    ),
    causeRankSection("top_dalys", "DALYs", place, year, calls.dalys, calls.causes),
    mapSection(
      calls.map,
      `HALE at birth${year === null ? "" : `, ${year}`}: places in and around ${place.name}`,
      `HALE for places inside or next to ${place.name} is not imported, so there is no map.`,
    ),
    ...(calls.deaths === undefined
      ? []
      : [
          causeRankSection(
            "top_deaths",
            "deaths",
            place,
            year,
            calls.deaths,
            calls.causes,
          ),
        ]),
  ];
  return {
    kind: "location",
    subject: place.name,
    year,
    attribution: GBD_LOCAL_ATTRIBUTION,
    sections,
    map: mapOf(calls.map),
  };
};

export type CauseCalls = Readonly<{
  cause: string;
  /** Set when the cause is not among the imported ones: every section says so. */
  unknown?: string;
  trend: ProfileCall | null;
  year: number | null;
  highest: ProfileCall | null;
  bySex: readonly ProfileCall[];
  /** Left out unless deaths were asked for. */
  deaths?: ProfileCall | null;
}>;

/** A cause profile: where it is highest, the world's trend, by sex, map; deaths when asked. Pure. */
export const assembleCauseProfile = (calls: CauseCalls): GbdProfile => {
  const { cause, year } = calls;
  const age = calls.trend?.input.age ?? "age_standardized";
  const ageWords = AGE_WORDS[age];
  const inYear = year === null ? "" : `, ${year}`;
  const notImported = (what: string) => calls.unknown ?? what;
  const highestRows = rowsOf(calls.highest).map((row) => toRow(row.location, row));
  const sexRows = calls.bySex.flatMap((call) =>
    rowsOf(call).map((row) =>
      toRow(call.input.sex === "female" ? "Female" : "Male", row),
    ),
  );
  const sections: ProfileSection[] = [
    section(
      {
        id: "highest",
        title: `Where ${cause} DALYs are highest${inYear}: rate per 100,000, ${ageWords}`,
        rowLabel: "Place",
        unit: unitOf([calls.highest]),
        ranked: true,
        rows: ranking(highestRows),
        auditIds: auditIdsOf([calls.highest]),
        note:
          highestRows.length > PROFILE_RANK_TOP
            ? `The ${PROFILE_RANK_TOP} highest of ${highestRows.length} imported countries.`
            : null,
      },
      notImported(`${cause} DALY rates by country are not imported.`),
    ),
    trendSection(
      `${cause} DALYs over time: the world, rate per 100,000, ${ageWords}`,
      [{ label: "DALYs", call: calls.trend }],
      null,
      `${cause} in the world`,
    ),
    section(
      {
        id: "by_sex",
        title: `${cause} DALYs by sex${inYear}: the world, rate per 100,000, ${ageWords}`,
        rowLabel: "Sex",
        unit: unitOf(calls.bySex),
        rows: sexRows,
        auditIds: auditIdsOf(calls.bySex),
      },
      notImported(`${cause} DALY rates for females and males are not imported.`),
    ),
    mapSection(
      calls.highest,
      `${cause} DALYs${inYear}: by country`,
      notImported(`${cause} DALY rates by country are not imported, so there is no map.`),
    ),
    ...(calls.deaths === undefined
      ? []
      : [
          section(
            {
              id: "deaths_trend" as const,
              title: `${cause} deaths over time: the world, rate per 100,000`,
              rowLabel: "Measure",
              unit: unitOf([calls.deaths]),
              rows: rowsOf(calls.deaths).map((row) => toRow("Deaths", row)),
              auditIds: auditIdsOf([calls.deaths]),
            },
            notImported(`${cause} death rates for the world are not imported.`),
          ),
        ]),
  ].map((entry) =>
    calls.unknown !== undefined && entry.status === "not_imported"
      ? { ...entry, note: calls.unknown }
      : entry,
  );
  return {
    kind: "cause",
    subject: cause,
    year,
    attribution: GBD_LOCAL_ATTRIBUTION,
    sections,
    map: mapOf(calls.highest),
  };
};

/** The sentence every section of a cause the import does not hold carries. */
export const unknownCauseNote = (
  cause: string,
  imported: readonly GbdNamed[],
): string => {
  const names = imported.map((entry) => entry.name).slice(0, 10);
  return names.length === 0
    ? `No cause estimates are imported, so ${cause} is not imported.`
    : `${cause} is not imported; imported causes: ${names.join(", ")}.`;
};

/** The year the follow-up calls ask for when the first calls found none. */
export const FALLBACK_YEAR = GBD_LAST_YEAR;

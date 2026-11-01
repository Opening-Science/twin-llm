import { type ChoroplethSpec } from "@/infrastructure/chat-view";
import {
  countryName,
  type LocationIndex,
  matchLocation,
  type MatchScope,
  subnationalCountries,
} from "@/infrastructure/charts/choropleth/match-location";
import type { MapLevel } from "@/infrastructure/view-specs";

import type { LocationEstimate, RecordedEstimates } from "./estimate-ledger";

/**
 * `map.choropleth` from the estimates the turn recorded: one estimate (the
 * measure, cause, year, sex, age and unit of the latest lookup), each place
 * matched to a boundary. Every number is a row's own. Pure; the audit and
 * the view id are `show-view-tool.ts`'s.
 */

export type MapRefusal = Readonly<{
  code:
    | "ESTIMATES_REQUIRED"
    | "COUNTRY_REQUIRED"
    | "NO_SUBNATIONAL_BOUNDARIES"
    | "NOTHING_TO_MAP";
  error: string;
}>;

const ESTIMATES_REQUIRED: MapRefusal = {
  code: "ESTIMATES_REQUIRED",
  error:
    "map.choropleth maps population estimates this turn looked up; look them up first, then call show_view again",
};

const COUNTRY_REQUIRED: MapRefusal = {
  code: "COUNTRY_REQUIRED",
  error: "level country needs country: an ISO 3166-1 alpha-3 code such as NGA",
};

const noSubnational = (index: LocationIndex): MapRefusal => ({
  code: "NO_SUBNATIONAL_BOUNDARIES",
  error: `no state or province boundaries for this country; these have them: ${subnationalCountries(index).join(", ")}`,
});

const NOTHING_TO_MAP: MapRefusal = {
  code: "NOTHING_TO_MAP",
  error: "none of the estimate's locations is a place at this level, so nothing is drawn",
};

const MEASURE_LABELS: Readonly<Record<string, string>> = {
  deaths: "Deaths",
  dalys: "DALYs",
  yld: "YLDs",
  yll: "YLLs",
  prevalence: "Prevalence",
  incidence: "Incidence",
};

const SEX_LABELS: Readonly<Record<string, string>> = {
  both: "both sexes",
  male: "males",
  female: "females",
};

const AGE_LABELS: Readonly<Record<string, string>> = {
  all_ages: "all ages",
  age_standardized: "age-standardised",
};

const words = (value: string): string => value.replace(/_/g, " ");

/** `Prevalence, Diabetes mellitus, 2021, both sexes, age-standardised`, from the row's own fields. */
export const estimateLabel = (row: LocationEstimate): string =>
  [
    row.measure === undefined
      ? "Estimate"
      : (MEASURE_LABELS[row.measure] ?? words(row.measure)),
    row.cause,
    row.year,
    row.sex === undefined ? undefined : (SEX_LABELS[row.sex] ?? words(row.sex)),
    row.age === undefined ? undefined : (AGE_LABELS[row.age] ?? words(row.age)),
  ]
    .filter((part): part is string => part !== undefined && part !== "")
    .join(", ");

/** Rows of one estimate share these; a map never mixes two. */
export const estimateKey = (row: LocationEstimate): string =>
  [row.measure, row.cause, row.year, row.sex, row.age, row.unit, row.source]
    .map((part) => part ?? "")
    .join("|");

export type MapRequest = Readonly<{ level: MapLevel; country: string | null }>;

export type MapBuilt = Readonly<{
  spec: ChoroplethSpec;
  /** `by country`, `Nigeria, by state`: the end of the title. */
  place: string;
  /** The tool calls the drawn rows came from. */
  callIds: readonly string[];
}>;

const placeOf = (index: LocationIndex, request: MapRequest): string => {
  if (request.level === "country" && request.country !== null) {
    return `${countryName(index, request.country)}, by state or province`;
  }
  return request.level === "region" ? "selected countries" : "by country";
};

/** The latest row per location, in first-seen order. */
const latestPerLocation = (
  rows: readonly (LocationEstimate & Readonly<{ callId: string }>)[],
) => [...new Map(rows.map((row) => [row.location, row] as const)).values()];

export const buildMapSpec = (
  index: LocationIndex,
  recorded: readonly RecordedEstimates[],
  request: MapRequest,
): MapBuilt | MapRefusal => {
  const all = recorded.flatMap((entry) =>
    entry.rows.map((row) => ({ ...row, callId: entry.callId })),
  );
  const latest = all.at(-1);
  if (latest === undefined) return ESTIMATES_REQUIRED;
  if (request.level === "country" && request.country === null) return COUNTRY_REQUIRED;
  if (
    request.level === "country" &&
    request.country !== null &&
    !subnationalCountries(index).includes(request.country)
  ) {
    return noSubnational(index);
  }
  const scope: MatchScope =
    request.level === "country" && request.country !== null
      ? { level: "states", country: request.country }
      : { level: "countries" };
  const key = estimateKey(latest);
  const rows = latestPerLocation(all.filter((row) => estimateKey(row) === key));
  const matched = rows.map((row) => ({
    row,
    match: matchLocation(index, row.location, scope),
  }));
  const regions = [
    ...new Map(
      matched.flatMap(({ row, match }) =>
        match === null
          ? []
          : [
              [
                match.code,
                {
                  code: match.code,
                  name: match.name,
                  location: row.location,
                  value: row.value,
                  lower: row.lower,
                  upper: row.upper,
                },
              ] as const,
            ],
      ),
    ).values(),
  ];
  if (regions.length === 0) return NOTHING_TO_MAP;
  return {
    spec: {
      level: request.level,
      country: scope.level === "states" ? scope.country : null,
      measure: latest.measure ?? "estimate",
      label: estimateLabel(latest),
      unit: latest.unit === "" ? null : latest.unit,
      source: latest.source ?? "population estimate",
      subject: null,
      regions,
      unmatched: matched.flatMap(({ row, match }) =>
        match === null ? [row.location] : [],
      ),
      n: rows.length,
    },
    place: placeOf(index, request),
    callIds: [...new Set(rows.map((row) => row.callId))],
  };
};

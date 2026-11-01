import { type ChoroplethSpec } from "@/infrastructure/chat-view";
import {
  countryName,
  type LocationIndex,
  type Match,
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
    | "STATES_REQUIRED"
    | "NO_SUBNATIONAL_BOUNDARIES"
    | "NOTHING_TO_MAP";
  error: string;
}>;

const ESTIMATES_REQUIRED: MapRefusal = {
  code: "ESTIMATES_REQUIRED",
  error:
    "map.choropleth maps population estimates this turn looked up; look them up first, then call show_view again",
};

const STATES_REQUIRED: MapRefusal = {
  code: "STATES_REQUIRED",
  error:
    "level country maps the states of one country; look up estimates for one country's states first (gbd_estimate: children_of the country)",
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
  [row.measure, row.cause, row.year, row.sex, row.age, row.metric, row.unit, row.source]
    .map((part) => part ?? "")
    .join("|");

/** `country` names whose states to draw; null at level country, the rows' own. */
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

/** A place's key: its GBD id when the tool gave one (names repeat, as Georgia does). */
const placeKey = (row: LocationEstimate): string =>
  row.location_id === undefined ? `name:${row.location}` : `id:${row.location_id}`;

/** The latest row per location, in first-seen order. */
const latestPerLocation = (
  rows: readonly (LocationEstimate & Readonly<{ callId: string }>)[],
) => [...new Map(rows.map((row) => [placeKey(row), row] as const)).values()];

/** True when the row's own level says it is not a place at this map level. */
const otherLevel = (row: LocationEstimate, scope: MatchScope): boolean => {
  if (row.level === undefined) return false;
  if (scope.level === "countries") return row.level !== "country";
  return (
    row.level !== "subnational" ||
    (row.iso3 !== undefined && row.iso3 !== null && row.iso3 !== scope.country)
  );
};

/** The ISO code a row's place goes by at this map level, when it has one. */
const isoCodeOf = (row: LocationEstimate, scope: MatchScope): string | null =>
  (scope.level === "countries" ? row.iso3 : row.iso3166_2) ?? null;

/**
 * The boundary for one estimate within `scope`, or null. An ISO code
 * (alpha-3 for a country, ISO 3166-2 for a state) is tried first, then the
 * name. A row whose level is known never matches a place at another level, so
 * the US state Georgia is not drawn on the country Georgia. Pure.
 */
export const matchEstimate = (
  index: LocationIndex,
  row: LocationEstimate,
  scope: MatchScope,
): Match | null => {
  if (otherLevel(row, scope)) return null;
  const code = isoCodeOf(row, scope);
  return (
    (code === null ? null : matchLocation(index, code, scope)) ??
    matchLocation(index, row.location, scope)
  );
};

/** The one alpha-3 every subnational row with a code shares, or null. */
const isoCountryOfStates = (rows: readonly LocationEstimate[]): string | null => {
  const countries = new Set(
    rows.flatMap((row) =>
      row.level === "subnational" && typeof row.iso3 === "string" ? [row.iso3] : [],
    ),
  );
  return countries.size === 1 ? ([...countries][0] ?? null) : null;
};

/**
 * The country whose states the rows are, when the request names none: of
 * the countries with state boundaries, the one most rows match (by code or
 * name). Null when none matches or two match as many.
 */
export const statesCountry = (
  index: LocationIndex,
  rows: readonly LocationEstimate[],
): string | null => {
  const scored = subnationalCountries(index)
    .map((country) => ({
      country,
      n: rows.filter(
        (row) => matchEstimate(index, row, { level: "states", country }) !== null,
      ).length,
    }))
    .filter((entry) => entry.n > 0)
    .sort((a, b) => b.n - a.n);
  const [best, next] = scored;
  if (best === undefined || (next !== undefined && next.n === best.n)) return null;
  return best.country;
};

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
  const key = estimateKey(latest);
  const rows = latestPerLocation(all.filter((row) => estimateKey(row) === key));
  const country =
    request.level === "country" ? (request.country ?? statesCountry(index, rows)) : null;
  const withBoundaries = (code: string) => subnationalCountries(index).includes(code);
  if (request.level === "country" && country === null) {
    const iso = isoCountryOfStates(rows);
    return iso !== null && !withBoundaries(iso) ? noSubnational(index) : STATES_REQUIRED;
  }
  if (country !== null && !withBoundaries(country)) return noSubnational(index);
  const scope: MatchScope =
    country === null ? { level: "countries" } : { level: "states", country };
  const matched = rows.map((row) => ({ row, match: matchEstimate(index, row, scope) }));
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
    place: placeOf(index, { ...request, country }),
    callIds: [...new Set(rows.map((row) => row.callId))],
  };
};

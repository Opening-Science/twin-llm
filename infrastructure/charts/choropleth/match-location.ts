import locationIndex from "./location-index.json";

/**
 * Finds the boundary a location names. A population estimate may name its
 * place by code (`NGA`, `NG-LA`) or by name (`United States of America`,
 * `Lagos State`); both resolve to the code the boundary file carries. Names
 * are compared without case, accents, punctuation, a leading "the" or a
 * trailing "state" or "province". Pure; the index is generated with the
 * boundaries (`scripts/geo/build-natural-earth.ts`).
 */

export type IndexedPlace = Readonly<{
  code: string;
  name: string;
  names: readonly string[];
}>;

export type IndexedState = IndexedPlace & Readonly<{ country: string }>;

export type LocationIndex = Readonly<{
  version: string;
  countries: readonly IndexedPlace[];
  states: readonly IndexedState[];
}>;

export const LOCATION_INDEX: LocationIndex = locationIndex;

const SUFFIX = /\s+(state|province|region|prefecture|oblast|county)$/;

export const normalizeName = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the\s+/, "")
    .replace(SUFFIX, "");

export type MatchScope =
  Readonly<{ level: "countries" }> | Readonly<{ level: "states"; country: string }>;

export type Match = Readonly<{ code: string; name: string }>;

const placesIn = (index: LocationIndex, scope: MatchScope): readonly IndexedPlace[] =>
  scope.level === "countries"
    ? index.countries
    : index.states.filter((state) => state.country === scope.country);

/**
 * The place `location` names within `scope`, or null. A code wins over a
 * name; among names, the first place listing it (Natural Earth's main name
 * comes first in each list).
 */
export const matchLocation = (
  index: LocationIndex,
  location: string,
  scope: MatchScope,
): Match | null => {
  const places = placesIn(index, scope);
  const code = location.trim().toUpperCase();
  const byCode = places.find((place) => place.code === code);
  if (byCode !== undefined) return { code: byCode.code, name: byCode.name };
  const wanted = normalizeName(location);
  if (wanted === "") return null;
  const byName = places.find((place) =>
    [place.name, ...place.names].some((name) => normalizeName(name) === wanted),
  );
  return byName === undefined ? null : { code: byName.code, name: byName.name };
};

/** Countries whose states and provinces have a boundary file. */
export const subnationalCountries = (index: LocationIndex): readonly string[] => [
  ...new Set(index.states.map((state) => state.country)),
];

/** A country's own name, for titles; the code when it has none. */
export const countryName = (index: LocationIndex, code: string): string =>
  index.countries.find((country) => country.code === code)?.name ?? code;

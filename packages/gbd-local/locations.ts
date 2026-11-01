/**
 * Lookups over the GBD location table (location-table.ts): ISO codes for a
 * GBD location id, a location by name or code, and the children of one.
 * Pure. An id the table does not hold is `unmapped`, never guessed; that
 * includes subnational units GBD 2023 added after the table's source.
 */
import { GBD_LOCATION_TABLE, type GbdLocationEntry } from "./location-table";

export type GbdLocation = Readonly<{
  id: number;
  parentId: number | null;
  level: number;
  name: string;
  /** ISO 3166-1 alpha-3; null for Global, super-regions and regions. */
  iso3: string | null;
  /** ISO 3166-2, for the subnational sets that have one; otherwise null. */
  iso3166_2: string | null;
}>;

export type IsoMapping =
  | Readonly<{ status: "aggregate" }>
  | Readonly<{ status: "country"; iso3: string }>
  | Readonly<{ status: "subnational"; iso3: string; iso3166_2: string | null }>
  | Readonly<{ status: "unmapped" }>;

const toLocation = ([
  id,
  parentId,
  level,
  name,
  iso3,
  iso3166_2,
]: GbdLocationEntry): GbdLocation => ({ id, parentId, level, name, iso3, iso3166_2 });

const BY_ID: ReadonlyMap<number, GbdLocation> = new Map(
  GBD_LOCATION_TABLE.map((entry) => [entry[0], toLocation(entry)]),
);

export const gbdLocationById = (id: number): GbdLocation | null => BY_ID.get(id) ?? null;

/** What the map knows about one GBD location id. */
export const isoMapping = (id: number): IsoMapping => {
  const location = BY_ID.get(id);
  if (location === undefined) return { status: "unmapped" };
  if (location.iso3 === null) return { status: "aggregate" };
  if (location.level === 3) return { status: "country", iso3: location.iso3 };
  return { status: "subnational", iso3: location.iso3, iso3166_2: location.iso3166_2 };
};

/** A name compared without case, accents or outer spaces. */
export const foldGbdName = (text: string): string =>
  text.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

/**
 * Every table location with this GBD name (case and accents ignored). Names
 * repeat (Georgia the country and the US state), so this can be more than one.
 */
export const gbdLocationsByName = (name: string): readonly GbdLocation[] =>
  [...BY_ID.values()].filter(
    (location) => foldGbdName(location.name) === foldGbdName(name),
  );

/** A country, or a unit with an alpha-3 code of its own (Hong Kong, Macao). */
const ownAlpha3 = (location: GbdLocation): boolean =>
  location.level === 3 ||
  (location.parentId !== null && BY_ID.get(location.parentId)?.iso3 !== location.iso3);

/** A country by ISO 3166-1 alpha-3, or a subnational unit by ISO 3166-2. */
export const gbdLocationByCode = (code: string): GbdLocation | null => {
  const upper = code.trim().toUpperCase();
  return (
    [...BY_ID.values()].find(
      (location) =>
        (location.iso3 === upper && ownAlpha3(location)) || location.iso3166_2 === upper,
    ) ?? null
  );
};

/** The direct children of one location id in the GBD hierarchy, by id. */
export const gbdChildIds = (parentId: number): readonly number[] =>
  [...BY_ID.values()]
    .filter((location) => location.parentId === parentId)
    .map((location) => location.id)
    .sort((a, b) => a - b);

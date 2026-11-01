/**
 * The pure half of `gbd_estimate`: which GBD location ids a call names, how
 * the estimates are ordered, and which asked location-year pairs have none.
 * No I/O; the store and the audit are in packages/query-tools/gbd-estimate.ts.
 */
import { GBD_AGE_IDS, type GbdAge } from "./constants";
import {
  foldGbdName,
  gbdChildIds,
  gbdLocationByCode,
  gbdLocationById,
  gbdLocationsByName,
} from "./locations";

export type GbdNamed = Readonly<{ id: number; name: string }>;

export type PlaceResolution =
  | Readonly<{ kind: "found"; id: number }>
  | Readonly<{ kind: "unknown" }>
  | Readonly<{ kind: "ambiguous"; options: readonly string[] }>;

/** GBD's id for Global, the whole world. */
export const GBD_GLOBAL_ID = 1;

/** Everyday names for Global, which GBD names only "Global". */
const WORLD_NAMES: ReadonlySet<string> = new Set(["world", "the world"]);

const describeId = (id: number, imported: readonly GbdNamed[]): string => {
  const location = gbdLocationById(id);
  const name = location?.name ?? imported.find((entry) => entry.id === id)?.name ?? "";
  const code = location?.iso3166_2 ?? location?.iso3 ?? null;
  return code === null ? `${name} (id ${id})` : `${name} (${code})`;
};

/**
 * One place as a call names it: an ISO 3166-1 alpha-3 or ISO 3166-2 code, a
 * GBD location id, or a name matched against the imported locations and the
 * location table (case and accents ignored). Two places with one name are
 * `ambiguous`, never a guess.
 */
export const resolveGbdPlace = (
  query: string,
  imported: readonly GbdNamed[],
): PlaceResolution => {
  const trimmed = query.trim();
  if (/^\d+$/.test(trimmed)) {
    const id = Number(trimmed);
    return gbdLocationById(id) !== null || imported.some((entry) => entry.id === id)
      ? { kind: "found", id }
      : { kind: "unknown" };
  }
  if (WORLD_NAMES.has(foldGbdName(trimmed))) return { kind: "found", id: GBD_GLOBAL_ID };
  const byCode = gbdLocationByCode(trimmed);
  if (byCode !== null) return { kind: "found", id: byCode.id };
  const ids = [
    ...new Set([
      ...imported
        .filter((entry) => foldGbdName(entry.name) === foldGbdName(trimmed))
        .map((entry) => entry.id),
      ...gbdLocationsByName(trimmed).map((location) => location.id),
    ]),
  ].sort((a, b) => a - b);
  if (ids.length === 0) return { kind: "unknown" };
  if (ids.length === 1) return { kind: "found", id: ids[0]! };
  return { kind: "ambiguous", options: ids.map((id) => describeId(id, imported)) };
};

/**
 * The imported locations directly inside one place, by id. Inside Global
 * (#394) that is every imported country, not the super-regions: a world map
 * is by country.
 */
export const importedChildIds = (
  parentId: number,
  imported: readonly GbdNamed[],
): readonly number[] => {
  const children = new Set(
    parentId === GBD_GLOBAL_ID
      ? imported.map((entry) => entry.id).filter((id) => gbdLocationById(id)?.level === 3)
      : gbdChildIds(parentId),
  );
  return imported
    .map((entry) => entry.id)
    .filter((id) => children.has(id))
    .sort((a, b) => a - b);
};

/** The imported SDI groups ("High SDI", "Low-middle SDI", ...), by id. */
export const importedSdiIds = (imported: readonly GbdNamed[]): readonly number[] =>
  imported
    .filter((entry) => /\bSDI$/.test(entry.name.trim()))
    .map((entry) => entry.id)
    .sort((a, b) => a - b);

/** A name from the imported list, case and accents ignored. */
export const findImportedName = (
  query: string,
  imported: readonly GbdNamed[],
): GbdNamed | null =>
  imported.find((entry) => foldGbdName(entry.name) === foldGbdName(query)) ?? null;

type Sortable = Readonly<{ year: number; value: number; location: string }>;

/** Oldest year first; within a year the largest value first, then by name. */
export const sortGbdEstimates = <T extends Sortable>(rows: readonly T[]): T[] =>
  [...rows].sort(
    (a, b) =>
      a.year - b.year || b.value - a.value || a.location.localeCompare(b.location, "en"),
  );

/** Asked location-year pairs with no estimate, in the order asked. */
export const missingPairs = (
  locationIds: readonly number[],
  years: readonly number[],
  found: readonly Readonly<{ locationId: number; year: number }>[],
): readonly Readonly<{ locationId: number; year: number }>[] => {
  const have = new Set(found.map((row) => `${row.locationId}:${row.year}`));
  return locationIds.flatMap((locationId) =>
    years
      .filter((year) => !have.has(`${locationId}:${year}`))
      .map((year) => ({ locationId, year })),
  );
};

/**
 * The GBD age id an age option reads: the first of its ids the import holds
 * (`at_birth` is the youngest life table group, 0-6 days in GBD 2023). Null
 * when none is imported.
 */
export const gbdAgeId = (age: GbdAge, importedAgeIds: readonly number[]): number | null =>
  GBD_AGE_IDS[age].find((id) => importedAgeIds.includes(id)) ?? null;

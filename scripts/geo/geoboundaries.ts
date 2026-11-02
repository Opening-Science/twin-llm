import type { StateUnit } from "./apply-rules";
import type { Ring } from "./shapefile";
import { signedArea } from "./simplify";

/**
 * Reading geoBoundaries (CC BY 4.0) ADM1 GeoJSON into the same units the
 * Natural Earth build uses (#422), so the same rules, simplification and
 * index apply. Pure; the build is `build-geoboundaries.ts`.
 */

type Position = readonly [number, number];

export type GeoBoundariesFeature = Readonly<{
  properties: Readonly<{ shapeName?: unknown; shapeISO?: unknown }>;
  geometry:
    | Readonly<{ type: "Polygon"; coordinates: readonly (readonly Position[])[] }>
    | Readonly<{
        type: "MultiPolygon";
        coordinates: readonly (readonly (readonly Position[])[])[];
      }>;
}>;

export type GeoBoundariesCollection = Readonly<{
  features: readonly GeoBoundariesFeature[];
}>;

const wound = (ring: readonly Position[], clockwise: boolean): Ring => {
  const points: Ring = ring.map(([x, y]) => [x, y] as const);
  return signedArea(points) <= 0 === clockwise ? points : [...points].reverse();
};

/**
 * A GeoJSON Polygon or MultiPolygon as rings wound the way a shapefile winds
 * them (outer rings clockwise, holes counter-clockwise), whatever winding
 * the file uses, so `nestRings` can rebuild the polygons.
 */
export const polygonRings = (geometry: GeoBoundariesFeature["geometry"]): Ring[] => {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap(([outer, ...holes]) =>
    outer === undefined
      ? []
      : [wound(outer, true), ...holes.map((hole) => wound(hole, false))],
  );
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" && value !== "None"
    ? value.trim()
    : null;

/**
 * One country's ADM1 features as units: code from `shapeISO` (ISO 3166-2),
 * name from `shapeName`. Throws when a feature has no code, a code of
 * another country or a code twice, so a new release cannot quietly drop a
 * unit.
 */
export const geoBoundariesUnits = (
  collection: GeoBoundariesCollection,
  country: string,
  iso2: string,
): StateUnit[] => {
  const units = collection.features.map((feature): StateUnit => {
    const code = text(feature.properties.shapeISO);
    const name = text(feature.properties.shapeName);
    if (code === null || !code.startsWith(`${iso2}-`)) {
      throw new Error(`${country}: ${name ?? "a feature"} has code ${code ?? "none"}`);
    }
    return {
      country,
      code,
      name: name ?? code,
      names: name === null ? [] : [name],
      rings: polygonRings(feature.geometry),
      fields: {},
    };
  });
  const codes = units.map((unit) => unit.code);
  const twice = codes.filter((code, index) => codes.indexOf(code) !== index);
  if (twice.length > 0) throw new Error(`${country}: codes twice ${twice.join(", ")}`);
  return units;
};

/**
 * The index's states with those of `countries` replaced by `replacement`,
 * ordered by `order` (the country list), each country's states in their
 * own order. Pure.
 */
export const replaceStates = <T extends Readonly<{ country: string }>>(
  states: readonly T[],
  countries: readonly string[],
  replacement: readonly T[],
  order: readonly string[],
): T[] => {
  const all = [
    ...states.filter((state) => !countries.includes(state.country)),
    ...replacement,
  ];
  const rank = (country: string) => {
    const at = order.indexOf(country);
    return at === -1 ? order.length : at;
  };
  return all
    .map((state, index) => ({ state, index }))
    .toSorted(
      (a, b) => rank(a.state.country) - rank(b.state.country) || a.index - b.index,
    )
    .map(({ state }) => state);
};

export type GeoBoundariesSource = Readonly<{
  country: string;
  /** ISO 3166-1 alpha-2, the prefix of the units' ISO 3166-2 codes. */
  iso2: string;
  file: string;
  sha256: string;
}>;

/**
 * The files built, from the geoBoundaries repository at one commit
 * (`releaseData/gbOpen/<ISO3>/ADM1/`, served by media.githubusercontent.com
 * as the files are in Git LFS). Kenya: build of 12 December 2023 from the
 * RCMRD GeoPortal counties of 2020 (public domain); geoBoundaries' work on
 * it is CC BY 4.0.
 */
export const GEOBOUNDARIES_COMMIT = "8ce2700661a28ee944350e2b329bbabb58d2ff83";

export const GEOBOUNDARIES_SOURCES: readonly GeoBoundariesSource[] = [
  {
    country: "KEN",
    iso2: "KE",
    file: "geoBoundaries-KEN-ADM1.geojson",
    sha256: "a3e073594494eb740e42fadec63acda982f6a745bb64ee4aa152453ccc46f94e",
  },
];

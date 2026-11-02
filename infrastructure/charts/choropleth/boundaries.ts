import { z } from "zod";

/**
 * The committed boundaries (`public/geo/natural-earth/`, and
 * `public/geo/geoboundaries/` for a few countries' states), as
 * the browser fetches them: GeoJSON MultiPolygons in degrees with an ISO
 * code and a name. Parsed before drawing so a bad file draws nothing.
 * Pure; the fetch lives in the map component.
 */

const position = z.tuple([z.number(), z.number()]);

export const boundaryFeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: z.object({
    code: z.string(),
    name: z.string(),
    /** Countries only: Natural Earth's label point, used to centre a country's map. */
    label: position.optional(),
  }),
  geometry: z.object({
    type: z.literal("MultiPolygon"),
    coordinates: z.array(z.array(z.array(position))),
  }),
});

export const boundaryCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(boundaryFeatureSchema),
});

export type BoundaryFeature = z.infer<typeof boundaryFeatureSchema>;

/**
 * Countries whose states are drawn from geoBoundaries (CC BY 4.0) instead
 * of Natural Earth, because Natural Earth's units are not GBD's (#422):
 * Kenya's 47 counties, where Natural Earth has the eight former provinces.
 */
export const GEOBOUNDARIES_COUNTRIES: readonly string[] = ["KEN"];

/**
 * The file under `/geo/` with the countries, or with one country's states
 * and provinces: `natural-earth/` for most, `geoboundaries/` for the
 * countries above.
 */
export const boundaryFile = (country: string | null): string =>
  country === null
    ? "natural-earth/admin0.json"
    : GEOBOUNDARIES_COUNTRIES.includes(country)
      ? `geoboundaries/admin1/${country}.json`
      : `natural-earth/admin1/${country}.json`;

/** The credit CC BY asks for, shown on a map drawn from these files. */
export type BoundaryCredit = Readonly<{
  /** `Boundaries: geoBoundaries (CC BY 4.0)`, for screen readers and copy. */
  text: string;
  source: string;
  url: string;
  licence: string;
  licenceUrl: string;
}>;

const GEOBOUNDARIES_CREDIT: BoundaryCredit = {
  text: "Boundaries: geoBoundaries (CC BY 4.0)",
  source: "geoBoundaries",
  url: "https://www.geoboundaries.org",
  licence: "CC BY 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
};

/**
 * The credit line a map of `country`'s states needs, or null for Natural
 * Earth's files, which are in the public domain and ask for none.
 */
export const boundaryCredit = (country: string | null): BoundaryCredit | null =>
  country !== null && GEOBOUNDARIES_COUNTRIES.includes(country)
    ? GEOBOUNDARIES_CREDIT
    : null;

export const parseBoundaries = (value: unknown): readonly BoundaryFeature[] | null => {
  const parsed = boundaryCollectionSchema.safeParse(value);
  return parsed.success ? parsed.data.features : null;
};

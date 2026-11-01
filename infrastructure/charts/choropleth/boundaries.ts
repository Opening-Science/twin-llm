import { z } from "zod";

/**
 * The committed Natural Earth boundaries (`public/geo/natural-earth/`), as
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
 * The file under `/geo/natural-earth/` with the countries, or with one
 * country's states and provinces.
 */
export const boundaryFile = (country: string | null): string =>
  country === null ? "admin0.json" : `admin1/${country}.json`;

export const parseBoundaries = (value: unknown): readonly BoundaryFeature[] | null => {
  const parsed = boundaryCollectionSchema.safeParse(value);
  return parsed.success ? parsed.data.features : null;
};

import { z } from "zod";

import type { BoundaryLayer } from "@/infrastructure/view-specs";

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
 * The file under `/geo/natural-earth/` with the countries, with one
 * country's states and provinces, or with one of its upper layers (the
 * United Kingdom's nations or regions, #421).
 */
export const boundaryFile = (
  country: string | null,
  layer: BoundaryLayer | null = null,
): string => {
  if (country === null) return "admin0.json";
  return layer === null ? `admin1/${country}.json` : `admin1/${country}-${layer}.json`;
};

export const parseBoundaries = (value: unknown): readonly BoundaryFeature[] | null => {
  const parsed = boundaryCollectionSchema.safeParse(value);
  return parsed.success ? parsed.data.features : null;
};

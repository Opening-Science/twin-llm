import { z } from "zod";

import { gbdLocationByCode, isoMapping } from "@/packages/gbd-local/locations";

import type { LocationEstimate, PlaceLevel } from "./estimate-ledger";

/**
 * `gbd_estimate` output (#387) as estimate rows for the map. The tool returns
 * one object (measure, metric, unit, cause, risk, sex, age and rows); each
 * row becomes one estimate with the place's GBD id, its ISO codes and its
 * level from the GBD location map, so the map can match boundaries by code
 * before name. A risk factor's estimate names the risk and the cause, as the
 * explainability panel does. Pure; anything else is null.
 */

const gbdEstimateOutput = z.object({
  source: z.string(),
  measure: z.string(),
  metric: z.string(),
  unit: z.string(),
  sex: z.string(),
  age: z.string(),
  cause: z.string().nullable(),
  risk: z.string().nullable(),
  rows: z
    .array(
      z.object({
        location: z.string().min(1),
        location_id: z.number().int(),
        iso3: z.string().nullable(),
        iso3166_2: z.string().nullable(),
        year: z.number().int(),
        value: z.number(),
        lower: z.number().nullable(),
        upper: z.number().nullable(),
      }),
    )
    .min(1),
});

/**
 * Country, subnational unit or aggregate, by the GBD location map. A unit
 * with an alpha-3 code of its own (Hong Kong, Macao) counts as a country; an
 * id the map does not hold has no level.
 */
export const gbdPlaceLevel = (locationId: number): PlaceLevel | undefined => {
  const mapping = isoMapping(locationId);
  if (mapping.status === "unmapped") return undefined;
  if (mapping.status === "aggregate") return "aggregate";
  if (mapping.status === "country") return "country";
  return gbdLocationByCode(mapping.iso3)?.id === locationId ? "country" : "subnational";
};

export const gbdEstimateRows = (output: unknown): readonly LocationEstimate[] | null => {
  const parsed = gbdEstimateOutput.safeParse(output);
  if (!parsed.success) return null;
  const result = parsed.data;
  const subject = [result.risk, result.cause]
    .filter((part): part is string => part !== null)
    .join(" · ");
  return result.rows.map((row) => {
    const level = gbdPlaceLevel(row.location_id);
    return {
      location: row.location,
      location_id: row.location_id,
      iso3: row.iso3,
      iso3166_2: row.iso3166_2,
      ...(level === undefined ? {} : { level }),
      value: row.value,
      lower: row.lower,
      upper: row.upper,
      unit: result.unit,
      metric: result.metric,
      measure: result.measure,
      ...(subject === "" ? {} : { cause: subject }),
      year: String(row.year),
      sex: result.sex,
      age: result.age,
      source: result.source,
    };
  });
};

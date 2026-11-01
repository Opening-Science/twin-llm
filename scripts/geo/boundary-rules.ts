import type { DbfValue } from "./shapefile";
import type { SimplifyOptions } from "./simplify";

/**
 * The choices behind the committed boundaries, kept apart from the build so
 * they are tested and stated in one place (and in the data README).
 */

/**
 * Countries GBD reports below country level in recent rounds (GBD 2021).
 * Their states or provinces are built from Natural Earth admin-1; GBD's own
 * units do not always match those (the United Kingdom's, for one), so a
 * location that matches no boundary is listed under the map instead.
 */
export const GBD_SUBNATIONAL: readonly string[] = [
  "BRA",
  "CHN",
  "ETH",
  "GBR",
  "IDN",
  "IND",
  "IRN",
  "ITA",
  "JPN",
  "KEN",
  "MEX",
  "NGA",
  "NOR",
  "NZL",
  "PAK",
  "PHL",
  "POL",
  "RUS",
  "SWE",
  "UKR",
  "USA",
  "ZAF",
];

/** Countries at 1:50m: 0.05 degree tolerance (about 5 km), 2 decimals (about 1 km). */
export const ADMIN0_OPTIONS: SimplifyOptions = {
  tolerance: 0.05,
  minArea: 0.01,
  decimals: 2,
};

/** States at 1:10m: 0.02 degree tolerance (about 2 km), 3 decimals. */
export const ADMIN1_OPTIONS: SimplifyOptions = {
  tolerance: 0.02,
  minArea: 0.002,
  decimals: 3,
};

const ISO3 = /^[A-Z]{3}$/;

/**
 * A country's ISO 3166-1 alpha-3 code. Natural Earth leaves `ISO_A3` as
 * `-99` for a few countries with a disputed or shared code (France and
 * Norway among them) and fills `ISO_A3_EH` instead; a unit with neither
 * falls back to its Natural Earth `ADM0_A3`.
 */
export const admin0Code = (row: Readonly<Record<string, DbfValue>>): string | null =>
  [row.ISO_A3, row.ISO_A3_EH, row.ADM0_A3].find(
    (value): value is string => typeof value === "string" && ISO3.test(value),
  ) ?? null;

/** `name_alt` holds several names separated by `|`. */
export const splitAltNames = (value: string | null): string[] =>
  value === null
    ? []
    : value
        .split("|")
        .map((name) => name.trim())
        .filter((name) => name !== "");

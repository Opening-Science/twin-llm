/**
 * Builds the choropleth boundaries from Natural Earth 5.1.1 (public domain).
 *
 * Usage (from repo root), after unzipping the two archives listed in
 * public/geo/natural-earth/README.md into one folder:
 *   bun scripts/geo/build-natural-earth.ts <folder>
 *
 * Writes public/geo/natural-earth/admin0.json (countries, 1:50m),
 * public/geo/natural-earth/admin1/<ISO3>.json (states and provinces, 1:10m,
 * one file per country GBD estimates subnationally) and
 * infrastructure/charts/choropleth/location-index.json (codes and names only, for
 * matching estimate locations on the server). States follow the reviewed
 * rules in gbd-boundaries.ts (#397): some are joined into GBD's units, some
 * recoded to current ISO 3166-2 codes. The README next to the files is kept.
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADMIN0_OPTIONS,
  ADMIN1_OPTIONS,
  admin0Code,
  GBD_SUBNATIONAL,
  splitAltNames,
} from "./boundary-rules";
import { GBD_LOCATION_TABLE } from "../../packages/gbd-local/location-table";

import { applyCountryRules, reserveGbdNames, type StateUnit } from "./apply-rules";
import { GBD_BOUNDARY_RULES } from "./gbd-boundaries";
import { mergeByCode } from "./merge-units";
import { readShapes, readTable, type DbfValue } from "./shapefile";
import { nestRings, simplifyFeature, type SimplifyOptions } from "./simplify";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "public/geo/natural-earth");
const INDEX = join(ROOT, "infrastructure/charts/choropleth/location-index.json");

const text = (value: DbfValue | undefined): string | null =>
  typeof value === "string" && value !== "" ? value : null;

const load = async (folder: string, base: string) => ({
  shapes: readShapes(new Uint8Array(await readFile(join(folder, `${base}.shp`)))),
  rows: readTable(new Uint8Array(await readFile(join(folder, `${base}.dbf`)))),
});

const geometry = (rings: Parameters<typeof nestRings>[0], options: SimplifyOptions) => ({
  type: "MultiPolygon" as const,
  coordinates: nestRings(simplifyFeature(rings, options)),
});

const unique = (values: readonly (string | null)[]): string[] => [
  ...new Set(values.filter((value): value is string => value !== null)),
];

const main = async () => {
  const folder = process.argv[2];
  if (folder === undefined) throw new Error("usage: build-natural-earth.ts <folder>");
  const admin0 = await load(folder, "ne_50m_admin_0_countries");
  const admin1 = await load(folder, "ne_10m_admin_1_states_provinces");

  const units = admin0.rows.flatMap((row, index) => {
    const code = admin0Code(row);
    if (code === null || code === "ATA") return [];
    return [
      {
        code,
        name: text(row.NAME) ?? code,
        names: unique([
          text(row.NAME),
          text(row.NAME_LONG),
          text(row.ADMIN),
          text(row.FORMAL_EN),
          text(row.NAME_EN),
          text(row.NAME_SORT),
          text(row.BRK_NAME),
          ...splitAltNames(text(row.NAME_ALT)),
        ]),
        label: [Number(row.LABEL_X), Number(row.LABEL_Y)] as const,
        rings: admin0.shapes[index],
      },
    ];
  });
  const countries = mergeByCode(units);

  await rm(join(OUT, "admin0.json"), { force: true });
  await rm(join(OUT, "admin1"), { recursive: true, force: true });
  await mkdir(join(OUT, "admin1"), { recursive: true });
  await writeFile(
    join(OUT, "admin0.json"),
    JSON.stringify({
      type: "FeatureCollection",
      features: countries.map((country) => ({
        type: "Feature",
        properties: { code: country.code, name: country.name, label: country.label },
        geometry: geometry(country.rings, ADMIN0_OPTIONS),
      })),
    }),
  );

  const source = admin1.rows.flatMap((row, index): StateUnit[] => {
    const country = text(row.adm0_a3);
    const code = text(row.iso_3166_2);
    if (country === null || code === null || !GBD_SUBNATIONAL.includes(country))
      return [];
    return [
      {
        country,
        code,
        name: text(row.name) ?? code,
        names: unique([
          text(row.name),
          text(row.name_en),
          text(row.gn_name),
          text(row.woe_name),
          ...splitAltNames(text(row.name_alt)),
        ]),
        rings: admin1.shapes[index] ?? [],
        fields: row,
      },
    ];
  });
  const states = GBD_SUBNATIONAL.flatMap((country) => {
    const rules = GBD_BOUNDARY_RULES[country] ?? {};
    const gbdUnits = GBD_LOCATION_TABLE.flatMap(([, , level, name, iso3, iso3166_2]) =>
      level >= 4 && iso3 === country ? [{ name, iso3166_2 }] : [],
    );
    return reserveGbdNames(
      applyCountryRules(country, rules, source),
      gbdUnits,
      rules.aliases,
    );
  });

  await Promise.all(
    GBD_SUBNATIONAL.map((country) =>
      writeFile(
        join(OUT, "admin1", `${country}.json`),
        JSON.stringify({
          type: "FeatureCollection",
          features: states
            .filter((state) => state.country === country)
            .map((state) => ({
              type: "Feature",
              properties: { code: state.code, name: state.name },
              geometry: geometry(state.rings, ADMIN1_OPTIONS),
            })),
        }),
      ),
    ),
  );

  await writeFile(
    INDEX,
    `${JSON.stringify({
      version: "Natural Earth 5.1.1",
      countries: countries.map((country) => ({
        code: country.code,
        name: country.name,
        names: country.names,
      })),
      states: states.map((state) => ({
        code: state.code,
        country: state.country,
        name: state.name,
        names: state.names,
      })),
    })}\n`,
  );

  const sizes = await Promise.all(
    ["admin0.json", ...GBD_SUBNATIONAL.map((country) => `admin1/${country}.json`)].map(
      async (file) => [file, (await stat(join(OUT, file))).size] as const,
    ),
  );
  for (const [file, size] of sizes) console.log(`${file}\t${size}`);
  console.log(`total\t${sizes.reduce((sum, [, size]) => sum + size, 0)}`);
  console.log(`index\t${(await stat(INDEX)).size}`);
};

await main();

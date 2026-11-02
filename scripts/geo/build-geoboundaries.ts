/**
 * Builds the states of the countries drawn from geoBoundaries (CC BY 4.0)
 * instead of Natural Earth (#422): Kenya's 47 counties.
 *
 * Usage (from repo root), after downloading the files listed in
 * GEOBOUNDARIES_SOURCES (geoboundaries.ts) into one folder:
 *   bun scripts/geo/build-geoboundaries.ts <folder>
 *
 * Writes public/geo/geoboundaries/admin1/<ISO3>.json and replaces those
 * countries' states in infrastructure/charts/choropleth/location-index.json,
 * with the same rules (gbd-boundaries.ts) and simplification as the Natural
 * Earth build. Run it after build-natural-earth.ts, which keeps these
 * countries' states in the index as they are. The README is kept.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { LocationIndex } from "../../infrastructure/charts/choropleth/match-location";
import { GBD_LOCATION_TABLE } from "../../packages/gbd-local/location-table";

import { applyCountryRules, reserveGbdNames } from "./apply-rules";
import { ADMIN1_OPTIONS, GBD_SUBNATIONAL } from "./boundary-rules";
import { GBD_BOUNDARY_RULES } from "./gbd-boundaries";
import {
  GEOBOUNDARIES_SOURCES,
  type GeoBoundariesCollection,
  geoBoundariesUnits,
  replaceStates,
} from "./geoboundaries";
import { nestRings, simplifyFeature } from "./simplify";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "public/geo/geoboundaries/admin1");
const INDEX = join(ROOT, "infrastructure/charts/choropleth/location-index.json");

const main = async () => {
  const folder = process.argv[2];
  if (folder === undefined) throw new Error("usage: build-geoboundaries.ts <folder>");
  await mkdir(OUT, { recursive: true });

  const built = await Promise.all(
    GEOBOUNDARIES_SOURCES.map(async (source) => {
      const bytes = await readFile(join(folder, source.file));
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (sha256 !== source.sha256) {
        throw new Error(`${source.file}: SHA-256 ${sha256}, expected ${source.sha256}`);
      }
      const collection = JSON.parse(bytes.toString("utf8")) as GeoBoundariesCollection;
      const rules = GBD_BOUNDARY_RULES[source.country] ?? {};
      const gbdUnits = GBD_LOCATION_TABLE.flatMap(([, , level, name, iso3, iso3166_2]) =>
        level >= 4 && iso3 === source.country ? [{ name, iso3166_2 }] : [],
      );
      const states = reserveGbdNames(
        applyCountryRules(
          source.country,
          rules,
          geoBoundariesUnits(collection, source.country, source.iso2),
        ),
        gbdUnits,
        rules.aliases,
      ).toSorted((a, b) => a.code.localeCompare(b.code));
      const file = join(OUT, `${source.country}.json`);
      await writeFile(
        file,
        JSON.stringify({
          type: "FeatureCollection",
          features: states.map((state) => ({
            type: "Feature",
            properties: { code: state.code, name: state.name },
            geometry: {
              type: "MultiPolygon",
              coordinates: nestRings(simplifyFeature(state.rings, ADMIN1_OPTIONS)),
            },
          })),
        }),
      );
      console.log(`admin1/${source.country}.json\t${(await stat(file)).size}`);
      return states.map((state) => ({
        code: state.code,
        country: state.country,
        name: state.name,
        names: state.names,
      }));
    }),
  );

  const index = JSON.parse(await readFile(INDEX, "utf8")) as LocationIndex;
  await writeFile(
    INDEX,
    `${JSON.stringify({
      ...index,
      states: replaceStates(
        index.states,
        GEOBOUNDARIES_SOURCES.map((source) => source.country),
        built.flat(),
        GBD_SUBNATIONAL,
      ),
    })}\n`,
  );
  console.log(`index\t${(await stat(INDEX)).size}`);
};

await main();

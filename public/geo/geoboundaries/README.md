# geoBoundaries boundaries

States for the `map.choropleth` view of countries whose Natural Earth units are not GBD's
(#422): Kenya's 47 counties, where Natural Earth has the eight former provinces.

Source: [geoBoundaries](https://www.geoboundaries.org) (Runfola D, Anderson A, Baier H et al.
(2020) geoBoundaries: A global database of political administrative boundaries. PLoS ONE
15(4): e0231866, https://doi.org/10.1371/journal.pone.0231866). geoBoundaries' files are
released under the [Creative Commons Attribution 4.0 International licence (CC BY
4.0)](https://creativecommons.org/licenses/by/4.0/), which asks for credit: a map drawn from
these files says "Boundaries: geoBoundaries (CC BY 4.0)" under it, with links to
geoboundaries.org and the licence. The files below are changed from the original (simplified,
rounded, one name corrected).

| File                             | geoBoundaries file (gbOpen, ADM1)                                                | Source and licence of the source                                       |
| -------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `admin1/KEN.json` (47, 30.6 KB) | `geoBoundaries-KEN-ADM1.geojson`, boundary `KEN-ADM1-32016919`, built 2023-12-12 | Counties of 2020 from the RCMRD GeoPortal (Africa GeoPortal), public domain |

Downloaded from the geoBoundaries repository on GitHub
(`wmgeolab/geoBoundaries`, `releaseData/gbOpen/KEN/ADM1/`) at commit
`8ce2700661a28ee944350e2b329bbabb58d2ff83`, through media.githubusercontent.com as the files
are in Git LFS. SHA-256 of `geoBoundaries-KEN-ADM1.geojson` (7.96 MB):
`a3e073594494eb740e42fadec63acda982f6a745bb64ee4aa152453ccc46f94e`. The build checks it.

## Files

- `admin1/<ISO3>.json`: GeoJSON MultiPolygons, one feature per unit, ordered by code. `code` is
  ISO 3166-2 (geoBoundaries' `shapeISO`), `name` is `shapeName`. geoBoundaries names KE-41
  "Tharaka"; it is renamed Tharaka-Nithi, the county's name (`scripts/geo/gbd-boundaries.ts`).
  The browser loads the file only when a map of that country's states is shown.
- Their states in `infrastructure/charts/choropleth/location-index.json` (not served), for
  matching on the server, as for Natural Earth.

## Method

`bun scripts/geo/build-geoboundaries.ts <folder>` reads the GeoJSON files listed in
`scripts/geo/geoboundaries.ts`, checks each SHA-256, takes each feature's ISO 3166-2 code and
name (and stops on a feature without a code of its country, or a code twice), applies the
country's rules, and simplifies exactly as the Natural Earth states are: Douglas-Peucker with a
tolerance of 0.02° (about 2 km), rings under 0.002 square degrees dropped except each unit's
largest, 3 decimals (`ADMIN1_OPTIONS` in `scripts/geo/boundary-rules.ts`). From 183,000 points
in 7.96 MB to 1,621 points in 30.6 KB. It writes the files here and replaces these countries'
states in the location index. Run it after `scripts/geo/build-natural-earth.ts`, which writes no
file for these countries and keeps their states in the index. The build is deterministic.

New Zealand is not drawn from here: GBD reports New Zealand's Maori and non-Maori populations,
which are groups of people, not areas, so no regional boundary set fits them
(`docs/gbd-map-coverage.md`).

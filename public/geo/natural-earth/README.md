# Natural Earth boundaries

Country and state boundaries for the `map.choropleth` view (#388).

Source: [Natural Earth](https://www.naturalearthdata.com/), version 5.1.1. Natural Earth is in the
public domain; no permission is needed to use it ("Made with Natural Earth").

| Archive (from naciscdn.org, the download host linked from naturalearthdata.com) | SHA-256                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `naturalearth/50m/cultural/ne_50m_admin_0_countries.zip`                        | `5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139` |
| `naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip`                 | `efc59726337323058f9446210adc96673179cd344e053666ee3d28cb58ba2b05` |

## Files

- `admin0.json`: 239 countries at 1:50m, Antarctica left out (436 KB). Property `code` is
  ISO 3166-1 alpha-3 (`ISO_A3`, else `ISO_A3_EH`, else Natural Earth's `ADM0_A3`, so France
  and Norway keep their codes); `name` is Natural Earth's `NAME`; `label` is its label point.
  Units sharing one code (Australia and two of its territories) are one feature.
- `admin1/<ISO3>.json`: states and provinces at 1:10m for the 22 countries GBD reports below
  country level (GBD 2021): BRA, CHN, ETH, GBR, IDN, IND, IRN, ITA, JPN, KEN, MEX, NGA, NOR,
  NZL, PAK, PHL, POL, RUS, SWE, UKR, USA, ZAF (1.6 MB together, 12 to 400 KB each). `code` is
  ISO 3166-2 (`iso_3166_2`), `name` is `name`. The browser loads one file when a map of that
  country is shown.
- `infrastructure/charts/choropleth/location-index.json` (136 KB, not served): codes and the
  names Natural Earth gives (`NAME`, `NAME_LONG`, `ADMIN`, `FORMAL_EN`, `name_alt` and others),
  used on the server to match an estimate's location to a boundary.

Natural Earth's admin-1 units are not always GBD's: Kenya has 8 former provinces (GBD uses 47
counties), Italy has 110 provinces (GBD uses 20 regions), the United Kingdom has 232 local
units. A location that matches no boundary is listed under the map, never dropped quietly.

## Method

`bun scripts/geo/build-natural-earth.ts <folder>` reads the unzipped shapefiles with our own
reader (`scripts/geo/shapefile.ts`), simplifies each ring with Douglas-Peucker on longitude and
latitude (`scripts/geo/simplify.ts`), drops rings smaller than a minimum area except each
feature's largest, rounds coordinates and writes GeoJSON MultiPolygons (RFC 7946 winding).
Settings (`scripts/geo/boundary-rules.ts`):

| Level     | Tolerance            | Minimum ring area | Decimals       |
| --------- | -------------------- | ----------------- | -------------- |
| Countries | 0.05° (about 5 km)   | 0.01 square °     | 2 (about 1 km) |
| States    | 0.02° (about 2 km)   | 0.002 square °    | 3              |

The build is deterministic: the same archives give the same files.

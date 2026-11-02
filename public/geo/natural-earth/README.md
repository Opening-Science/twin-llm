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
  NZL, PAK, PHL, POL, RUS, SWE, UKR, USA, ZAF (1.5 MB together, 10 to 390 KB each). `code` is
  ISO 3166-2 (`iso_3166_2`, brought up to date where Natural Earth's is old, see below) or
  `GBD-<location id>` for a unit joined to fit GBD that has no ISO code; `name` is `name`.
  The browser loads one file when a map of that country is shown.
- `admin1/GBR-nations.json` (23 KB) and `admin1/GBR-regions.json` (31 KB): the United
  Kingdom's upper levels, joined from the GBR units (#421, below). Nations: England, Scotland,
  Wales and Northern Ireland, `code` their ISO 3166-2 code. Regions: the 12 ITL1 regions,
  England's nine (`code` `GBD-<location id>`, as they have no ISO code; GBD's name, ONS's as
  another name where it differs) with Scotland, Wales and Northern Ireland. A map uses the
  file most of its places match.
- `infrastructure/charts/choropleth/location-index.json` (115 KB, not served): codes and the
  names Natural Earth gives (`NAME`, `NAME_LONG`, `ADMIN`, `FORMAL_EN`, `name_alt` and others),
  used on the server to match an estimate's location to a boundary. Units of an upper layer
  carry `layer` (`nations`, `regions`).

## Fitted to GBD's units (#397)

Some of these files are derived data: Natural Earth's units, joined or recoded to match the
units GBD reports. The rules are in `scripts/geo/gbd-boundaries.ts`, reviewed by hand with the
source of each; the build stops when a rule names a unit that is not there.

- Joined (`dissolve`): the units listed are merged into one and the borders they share are
  dropped (`scripts/geo/dissolve.ts`; Natural Earth's neighbours share their border vertices
  exactly, so nothing is left inside), before simplifying. Italy: the 107 provinces into the 19
  regions by Natural Earth's `region_cod`, with Bolzano and Trento kept as GBD has them. Norway:
  the 19 counties before 2020 into the 11 of 2020 to 2023 (Viken is Østfold, Akershus and
  Buskerud, and so on); a few municipalities that changed county in 2020, Jevnaker and Svelvik
  among them, are drawn in their old county. Sweden: every county but Stockholm into "Sweden
  except Stockholm". Ukraine: the oblasts and Kyiv into "Ukraine (without Crimea &
  Sevastopol)", with Crimea and Sevastopol, which Natural Earth files under Russia, drawn as
  their own units as GBD and ISO 3166-2 have them (`borrow`; they stay in the Russia file too).
  India: Jammu and Kashmir with Ladakh, and the five other union territories into one. The
  Philippines: the cities of the National Capital Region into the region (PH-00).
- Recoded (`recode`): Natural Earth carries codes ISO 3166-2 has since changed, for Poland
  (2018), Iran (2020, where Natural Earth also gives Alborz Tehran's old code), India (2023),
  South Africa (2020) and Mexico City (MX-DIF to MX-CMX). Nairobi province gets Nairobi City
  County's code, KE-30, as they are one area. Natural Earth has the codes of Moscow city and
  Moscow oblast swapped, and wrong names for Wirral and St Helens (`rename`).
- Names: GBD names that differ from Natural Earth's are added to the boundary they name
  (`aliases`, such as "Bristol, City of"), and a GBD unit's name is taken out of every other
  boundary's alternative names, so "Southampton" no longer finds Hampshire.

Natural Earth's admin-1 units are still not always GBD's. Kenya has 8 former provinces where
GBD uses 47 counties, which cannot be split; North Kalimantan, Davao Occidental and the
Dinagat Islands are drawn inside their former provinces. `docs/gbd-map-coverage.md` has the
match rate per country. A location that matches no boundary is listed under the map, never
dropped quietly.

## United Kingdom: nations and English regions (#421)

GBD reports the United Kingdom at three levels: four nations, England's nine regions and
England's local authorities. `admin1/GBR.json` has Natural Earth's 232 local units; the two
upper levels are built from the same units, joined before simplifying as above
(`layers` in `scripts/geo/gbd-boundaries.ts`, the mapping in `scripts/geo/uk-levels.ts`, tested
in `uk-levels.test.ts`). The build stops if a GBR unit lies in no unit of a layer or in two.

Mapping, local unit to English region to nation:

- English regions: ONS, "Local Authority District to Region (December 2018) Lookup in England"
  and "Local Authority District to County (December 2018) Lookup in England", from the ONS
  Open Geography Portal, under the Open Government Licence v3.0 (contains National Statistics
  data, Crown copyright and database right 2018). Each of Natural Earth's 152 English units
  was found by name as a 2018 district or unitary authority, or, for a two-tier county, through
  its districts, which all lie in one region. ONS's region agrees with Natural Earth's own
  `region` field for all 152.
- Nations: Natural Earth's `geonunit` (England, Scotland, Wales, Northern Ireland).

Where Natural Earth's units differ from today's ONS units (none of these moves a unit to
another region or nation, so the joined outlines are not affected):

- Natural Earth's English units are of 2009 to 2019: Bournemouth and Poole apart from Dorset
  (since 2019 Bournemouth, Christchurch and Poole, and Dorset), Northamptonshire (since 2021
  North and West Northamptonshire), and the two-tier counties Buckinghamshire, Cumbria, North
  Yorkshire and Somerset (unitary or split since 2020 to 2023). Two-tier counties stand for
  all their districts.
- Northern Ireland has the 26 districts before 2015, not today's 11.
- Natural Earth files Wirral under GB-WRL with the name Halton and St Helens under GB-SHN
  with the name Merseyside (renamed above), and spells North Ayrshire "North Ayshire".
- Natural Earth's `region` field for Wales has the two NUTS 2 areas swapped (Swansea under
  East Wales); it is not used.
- The outlines are Natural Earth's at 1:10m, simplified, not ONS boundaries: the Isles of
  Scilly and other small islands fall below the minimum ring area, and coasts follow Natural
  Earth's line.

## Method

`bun scripts/geo/build-natural-earth.ts <folder>` reads the unzipped shapefiles with our own
reader (`scripts/geo/shapefile.ts`), applies the rules above, simplifies each ring with
Douglas-Peucker on longitude and latitude (`scripts/geo/simplify.ts`), drops rings smaller
than a minimum area except each feature's largest, rounds coordinates and writes GeoJSON
MultiPolygons (RFC 7946 winding). It rewrites the two data folders and keeps this README.
Settings (`scripts/geo/boundary-rules.ts`):

| Level     | Tolerance            | Minimum ring area | Decimals       |
| --------- | -------------------- | ----------------- | -------------- |
| Countries | 0.05° (about 5 km)   | 0.01 square °     | 2 (about 1 km) |
| States    | 0.02° (about 2 km)   | 0.002 square °    | 3              |

The build is deterministic: the same archives give the same files.

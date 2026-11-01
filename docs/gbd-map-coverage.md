# GBD units on the map: match rate

How many of GBD's subnational units find a state or province boundary on the choropleth
map (#388), per country GBD estimates below country level, before and after #397. A unit is
matched the way the map matches an estimate: by its ISO 3166-2 code first, then by name,
among the boundaries of its own country. Units come from the committed location table
(`packages/gbd-local/location-table.ts`, ids and names only); boundaries from the committed
Natural Earth index (`infrastructure/charts/choropleth/location-index.json`). No estimates
are read. Research use only.

Regenerate the "after" section with `bun scripts/geo/match-rate.ts`. `scripts/geo/gbd-boundaries.test.ts`
fails if a unit is left unmatched without a recorded reason, if two units land on one boundary
or if a unit matches through a name that is not a reviewed alias.

## Before and after

Before is `main` at 12e46066. "Wrong" counts matches that were found but landed on the wrong
boundary; they were checked by hand and are listed below.

| Country | GBD units | Before: matched | Of which wrong | Before: right | After: matched | After |
| ------- | --------: | --------------: | -------------: | ------------: | -------------: | ----: |
| BRA     |        27 |              27 |              0 |          100% |             27 |  100% |
| CHN     |        31 |              31 |              0 |          100% |             31 |  100% |
| ETH     |        11 |              11 |              1 |           91% |             11 |  100% |
| GBR     |       163 |             147 |              3 |           88% |            150 |   92% |
| IDN     |        34 |              33 |              0 |           97% |             33 |   97% |
| IND     |        93 |              29 |              0 |           31% |             31 |   33% |
| IRN     |        31 |              29 |              1 |           90% |             31 |  100% |
| ITA     |        21 |               8 |              6 |           10% |             21 |  100% |
| JPN     |        47 |              47 |              0 |          100% |             47 |  100% |
| KEN     |        47 |               1 |              0 |            2% |              1 |    2% |
| MEX     |        32 |              31 |              0 |           97% |             32 |  100% |
| NGA     |        37 |              36 |              0 |           97% |             37 |  100% |
| NOR     |        11 |               4 |              0 |           36% |             11 |  100% |
| NZL     |         2 |               0 |              0 |            0% |              0 |    0% |
| PAK     |         7 |               6 |              0 |           86% |              7 |  100% |
| PHL     |        82 |              78 |              1 |           94% |             80 |   98% |
| POL     |        16 |              14 |              0 |           88% |             16 |  100% |
| RUS     |        83 |              63 |              1 |           75% |             83 |  100% |
| SWE     |         2 |               1 |              0 |           50% |              2 |  100% |
| UKR     |         3 |               0 |              0 |            0% |              3 |  100% |
| USA     |        51 |              51 |              0 |          100% |             51 |  100% |
| ZAF     |         9 |               9 |              0 |          100% |              9 |  100% |
| All     |       840 |             656 |             13 |           77% |            714 |   85% |

Of the 126 units still unmatched, 64 are not areas (the urban and rural halves of India's
states, New Zealand's Maori and non-Maori populations) and 46 are Kenyan counties, which
Natural Earth's eight former provinces cannot be split into. Counting areas only and leaving
Kenya out, 713 of 729 units are matched (98%).

Wrong before:

- Italy: six regions found one of their provinces through Natural Earth's alternative names
  (Emilia-Romagna drew Rimini, Friuli-Venezia Giulia Udine, Liguria Genoa, Piemonte
  Verbano-Cusio-Ossola, Puglia Foggia, Sicilia Trapani); the other 13 regions matched nothing.
- Ethiopia: Addis Ababa drew Oromia.
- Russia: Saint Petersburg drew Leningrad oblast.
- Iran: Alborz and Tehran shared one code (IR-07), so the map could colour only one.
- The Philippines: the Dinagat Islands drew Surigao del Norte.
- United Kingdom: Greater London drew Wandsworth, the West Midlands region drew Solihull and
  Southampton drew Hampshire.

## What changed

- ISO 3166-2 codes for 399 more units in `scripts/gbd/iso-3166-2.ts` (now 614), from the
  Wikipedia "ISO 3166-2" page of each country.
- Natural Earth units joined or recoded to GBD's units and to current ISO codes, by the
  reviewed rules in `scripts/geo/gbd-boundaries.ts`: Italy's regions, Norway's 2020 counties,
  Sweden except Stockholm, Ukraine without Crimea and Sevastopol (with both drawn), India's
  Jammu & Kashmir and Ladakh and its other union territories, the National Capital Region of
  the Philippines; new codes for Poland, Iran, India, South Africa, Mexico City, Nairobi and
  Moscow. Method in `public/geo/natural-earth/README.md`.
- A short alias table for GBD names Natural Earth spells differently, and GBD names removed
  from the alternative names of boundaries they do not name.

Left unmatched on purpose: GBD's UK nations and English regions (the UK file has local
authorities, and a country has one boundary file, so they would overlap), North Kalimantan,
Davao Occidental and the Dinagat Islands (newer than Natural Earth's provinces), Kenya's
counties and the groups that are not areas. Hong Kong and Macao carry their own alpha-3 codes
and are drawn on the world map, not China's.

## After (output of `bun scripts/geo/match-rate.ts`)

| Country | GBD units | By code | By name | By other name | Unmatched | Matched |
| ------- | --------: | ------: | ------: | ------------: | --------: | ------: |
| BRA     |        27 |      27 |       0 |             0 |         0 |    100% |
| CHN     |        31 |      31 |       0 |             0 |         0 |    100% |
| ETH     |        11 |      11 |       0 |             0 |         0 |    100% |
| GBR     |       163 |       0 |     145 |             5 |        13 |     92% |
| IDN     |        34 |      33 |       0 |             0 |         1 |     97% |
| IND     |        93 |      29 |       2 |             0 |        62 |     33% |
| IRN     |        31 |      31 |       0 |             0 |         0 |    100% |
| ITA     |        21 |      21 |       0 |             0 |         0 |    100% |
| JPN     |        47 |      47 |       0 |             0 |         0 |    100% |
| KEN     |        47 |       1 |       0 |             0 |        46 |      2% |
| MEX     |        32 |      32 |       0 |             0 |         0 |    100% |
| NGA     |        37 |      37 |       0 |             0 |         0 |    100% |
| NOR     |        11 |      11 |       0 |             0 |         0 |    100% |
| NZL     |         2 |       0 |       0 |             0 |         2 |      0% |
| PAK     |         7 |       7 |       0 |             0 |         0 |    100% |
| PHL     |        82 |      79 |       1 |             0 |         2 |     98% |
| POL     |        16 |      16 |       0 |             0 |         0 |    100% |
| RUS     |        83 |      83 |       0 |             0 |         0 |    100% |
| SWE     |         2 |       1 |       1 |             0 |         0 |    100% |
| UKR     |         3 |       2 |       1 |             0 |         0 |    100% |
| USA     |        51 |      51 |       0 |             0 |         0 |    100% |
| ZAF     |         9 |       9 |       0 |             0 |         0 |    100% |
| All     |       840 |         |         |               |       126 |     85% |

### GBR

- unmatched, a nation; the boundary file has local authorities, one level per country: England; Northern Ireland; Scotland; Wales
- unmatched, a region of England; the boundary file has local authorities: East Midlands; East of England; Greater London; North East England; North West England; South East England; South West England; West Midlands; Yorkshire and the Humber
- by other name: County Durham -> GB-DUR
- by other name: Windsor and Maidenhead -> GB-WNM
- by other name: Bristol, City of -> GB-BST
- by other name: Herefordshire, County of -> GB-HEF
- by other name: Kingston upon Hull, City of -> GB-KHL

### IDN

- unmatched, made a province in 2012; Natural Earth still draws it in East Kalimantan: North Kalimantan

### IND

- unmatched, the urban or rural population of a state, not an area: Andhra Pradesh, Rural; Andhra Pradesh, Urban; Arunachal Pradesh, Rural; Arunachal Pradesh, Urban; Assam, Rural; Assam, Urban; Bihar, Rural; Bihar, Urban; Chhattisgarh, Rural; Chhattisgarh, Urban; Delhi, Rural; Delhi, Urban; Goa, Rural; Goa, Urban; Gujarat, Rural; Gujarat, Urban; Haryana, Rural; Haryana, Urban; Himachal Pradesh, Rural; Himachal Pradesh, Urban; Jammu & Kashmir and Ladakh, Rural; Jammu & Kashmir and Ladakh, Urban; Jharkhand, Rural; Jharkhand, Urban; Karnataka, Rural; Karnataka, Urban; Kerala, Rural; Kerala, Urban; Madhya Pradesh, Rural; Madhya Pradesh, Urban; Maharashtra, Rural; Maharashtra, Urban; Manipur, Rural; Manipur, Urban; Meghalaya, Rural; Meghalaya, Urban; Mizoram, Rural; Mizoram, Urban; Nagaland, Rural; Nagaland, Urban; Odisha, Rural; Odisha, Urban; Other Union Territories, Rural; Other Union Territories, Urban; Punjab, Rural; Punjab, Urban; Rajasthan, Rural; Rajasthan, Urban; Sikkim, Rural; Sikkim, Urban; Tamil Nadu, Rural; Tamil Nadu, Urban; Telangana, Rural; Telangana, Urban; Tripura, Rural; Tripura, Urban; Uttar Pradesh, Rural; Uttar Pradesh, Urban; Uttarakhand, Rural; Uttarakhand, Urban; West Bengal, Rural; West Bengal, Urban

### KEN

- unmatched, a county; Natural Earth has the eight former provinces, which hold several counties each: Baringo; Bomet; Bungoma; Busia; Elgeyo-Marakwet; Embu; Garissa; Homa Bay; Isiolo; Kajiado; Kakamega; Kericho; Kiambu; Kilifi; Kirinyaga; Kisii; Kisumu; Kitui; Kwale; Laikipia; Lamu; Machakos; Makueni; Mandera; Marsabit; Meru; Migori; Mombasa; Murang'a; Nakuru; Nandi; Narok; Nyamira; Nyandarua; Nyeri; Samburu; Siaya; Taita Taveta; Tana River; Tharaka Nithi; Trans Nzoia; Turkana; Uasin Gishu; Vihiga; Wajir; West Pokot

### NZL

- unmatched, a population group, not an area: New Zealand Maori population; New Zealand non-Maori population

### PHL

- unmatched, made a province in 2013; Natural Earth still draws it in Davao del Sur: Davao Occidental
- unmatched, made a province in 2006; Natural Earth still draws it in Surigao del Norte: Dinagat Islands

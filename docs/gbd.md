# IHME GBD population context

Population estimates from the IHME Global Burden of Disease study. They are
never a statement about a person. TwinLLM has two routes to them:

1. **Local store (GBD 2023, preferred).** A person downloads results from
   IHME's GBD Results Tool, imports the CSV files with `bun run gbd:import`,
   and chat reads them with the closed tool `gbd_estimate`. Nothing is sent
   anywhere, so it works in synthetic and personal mode (#387).
2. **Remote MCP server.** The optional `gbd_population` connector to an IHME
   GBD MCP server, synthetic mode only. It is unchanged and is used when
   nothing is imported.

When the local store holds any estimate, a chat turn gets `gbd_estimate` and
not `gbd_population`: the local store is preferred, and one population tool
keeps the prompt small. Wearable summaries and genome rows never reach either
tool; both take population fields only.

## Terms of use

GBD results from IHME are free for non-commercial use with attribution, under
the [IHME Free-of-Charge Non-Commercial User Agreement](https://www.healthdata.org/Data-tools-practices/data-practices/ihme-free-charge-non-commercial-user-agreement)
and IHME's [terms and conditions](https://www.healthdata.org/data-tools-practices/data-practices/terms-and-conditions).
Downloading needs a free IHME account, which each person creates and signs in
to themselves; TwinLLM never signs in, accepts terms or downloads for them.

**Never commit IHME data.** The CSV files stay where the person saved them,
and the rows live only in their local database. The repository holds made-up
fixtures in the export layout (labelled as made up; the values are not real)
and the location map below, which holds ids, names and codes but no estimates.

Every figure is shown with the attribution
`Population estimate (IHME GBD 2023), not a statement about this person.`

## Local store

### Exporting from the GBD Results Tool

The steps follow IHME's
[GBD Results Tool User Guide (GBD 2023)](https://www.healthdata.org/sites/default/files/2025-10/GBD_Results_Tool_User_Guide_2023.pdf),
"Querying the Data" and "Saving and Downloading Results".

1. Open <https://vizhub.healthdata.org/gbd-results/> and sign in or register;
   the tool needs an account to download.
2. GBD Estimate: "Cause of death or injury", "Risk factor" for burden
   attributable to a risk, or "Life expectancy and HALE".
3. Measure: any of Deaths, DALYs, YLDs, YLLs, Prevalence, Incidence, Life
   expectancy, HALE (Healthy life expectancy).
4. Metric: Number, Rate and/or Percent (Years for life expectancy and HALE).
5. Cause (and Risk for a risk factor query), Location, Age ("All ages" and/or
   "Age-standardized"; for life expectancy and HALE the youngest age group,
   which `gbd_estimate` reads as at birth), Sex and Year. To compare
   by SDI, also tick the SDI groups (High SDI to Low SDI) under Location.
6. Click Search, then Download.
7. Choose **Both** (IDs and names), enter an email address and click Submit.
8. Open the "download ready" email, follow the link to the status page and
   download the file or files (they stay there for 7 days). Unzip if needed.
9. Run `bun run gbd:import ~/Downloads/IHME-GBD_2023_DATA-*.csv`.
   Keep the download's `citation.txt` next to the CSV files: the import stores
   its citation, which GBD profiles show (#417).

IHME advises narrow queries: a very large query can return files that leave
out some ages or years. Several smaller downloads import fine; the same
estimate from two files is stored once.

### CSV layout

The user guide says that a download holds IDs, names or both, and that the
files of one query share their columns and a header row. It does not list the
column names, and IHME's codebook that does is behind the same sign-in, so
the names below are not checked against an IHME page. They match the
name-only columns in the CRAN package
[hmsidwR](https://cran.r-project.org/web/packages/hmsidwR/refman/hmsidwR.html)
(measure, location, sex, cause, metric, year, val, upper, lower), which takes
its data from the Results Tool.

```
measure_id, measure_name, location_id, location_name, sex_id, sex_name,
age_id, age_name, cause_id, cause_name, metric_id, metric_name, year,
val, upper, lower
```

A risk factor export adds `rei_id, rei_name` (risk, etiology or impairment)
next to or instead of the cause pair. A life expectancy or HALE export has
neither pair, and GBD 2023 exports start with `population_group_id,
population_group_name` (#394):

```
population_group_id, population_group_name, measure_id, measure_name,
location_id, location_name, sex_id, sex_name, age_id, age_name, metric_id,
metric_name, year, val, upper, lower
```

So the cause and risk pairs are optional, and a row with neither is stored
with no subject. Only the "All Population" group (id 1) is read; the store does
not key rows by group, so a file with another group is refused rather than
merged into it. Columns are found by name, so order does not matter. `val` is the estimate, `upper` and `lower` the 95% uncertainty
interval; an empty bound stays empty, never 0. The parser
(`packages/gbd-local/results-csv.ts`) refuses with a code:

- `GBD_CSV_NAMES_ONLY`, `GBD_CSV_IDS_ONLY`: download again with Both.
- `GBD_CSV_COLUMNS`: not a Results Tool export; the missing columns are named
  (also half of a cause or risk pair).
- `GBD_CSV_POPULATION_GROUP`: a row for a population group other than All
  Population, with its line.
- `GBD_CSV_ROW`: a row with a missing or non-numeric id, year or value, with
  its line.
- `GBD_CSV_UNREADABLE`: a quoted field is not closed.

### Import

`bun run gbd:import <files...>` (`scripts/gbd/import.ts`) parses each file,
records its SHA-256, base name, row count and new rows in `gbd_imports`, and
writes the rows to `gbd_estimates` keyed by measure, location, sex, age,
cause, risk, metric and year. A file whose checksum is already recorded is
skipped; a refused file does not stop the others (exit code 1). It prints file
names, checksums and counts only. The database is `DATABASE_URL`, as for the
app; for the eval database run
`bun --env-file=.env.eval --preload ./features/chat/response/preload-server-only.mjs scripts/gbd/import.ts <files...>`.

Import is CLI only. An upload on Customize · Data would need large-file
handling (one query can be hundreds of megabytes), which is more than a small
addition to that page.

### Location map

`packages/gbd-local/location-table.ts` maps each GBD location id to its parent,
level, name, ISO 3166-1 alpha-3 code and, where one exists, ISO 3166-2 code;
`packages/gbd-local/locations.ts` reads it (`isoMapping`, lookups by name or
code, children of a place). `scripts/gbd/build-location-map.ts` builds it from
IHME's public location metadata file
([ihmeuw/CHAIN_IHME_adultmortality_edu_sysreview, `loction_metadata.csv`](https://github.com/ihmeuw/CHAIN_IHME_adultmortality_edu_sysreview/blob/main/loction_metadata.csv)),
in which a country's `ihme_loc_id` is its alpha-3 code. The GBD 2023
hierarchy file on the GHDx needs a sign-in, so it is not used.

- 1,075 locations: Global, 7 super-regions, 21 regions, 204 countries and
  territories, and 842 subnational units.
- ISO 3166-2 for 614 subnational units (`scripts/gbd/iso-3166-2.ts`). US states
  and DC, Brazilian states, Mexican states, Japanese prefectures, Chinese
  provinces (Hong Kong and Macao also get their own alpha-3, HKG and MAC),
  Italian regions and autonomous provinces and the four UK nations were checked
  by hand against the ISO Online Browsing Platform. The states, provinces,
  regions and counties of Ethiopia, India, Indonesia, Iran, Kenya, Nigeria,
  Norway (the 11 counties of 2020), Pakistan, the Philippines, Poland, Russia
  and South Africa, Stockholm, Crimea and Sevastopol were paired by hand with
  the current codes listed on the Wikipedia "ISO 3166-2" page of each country
  (#397). After a change to that file, `bun scripts/gbd/build-location-map.ts
--codes` rewrites the table's codes.
- Units that are not ISO subdivisions keep their country's alpha-3 and a null
  ISO 3166-2 code: English regions and local authorities, the urban and rural
  halves of Indian states, India's "Other Union Territories" and "Jammu &
  Kashmir and Ladakh", Sweden except Stockholm, Ukraine without Crimea and
  Sevastopol, New Zealand's two population groups, and Maguindanao (its code
  was withdrawn when it split in 2022).
- How these units meet the map's boundaries is in
  [`gbd-map-coverage.md`](gbd-map-coverage.md).
- An id the table does not hold, such as a unit GBD 2023 added after the
  source file, is `unmapped`; nothing is guessed. Its rows still import and
  are found by name.

### Tool: `gbd_estimate`

Closed `.strict()` input (`packages/query-tools/gbd-estimate-schema.ts`):

| Field         | Values                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------- |
| `measure`     | `hale`, `life_expectancy`, `dalys`, `yld`, `prevalence`, `incidence`, `yll`, `deaths`    |
| `metric`      | `number`, `percent`, `rate` (per 100,000), `years`                                       |
| `cause`       | IHME cause name, e.g. `Cardiovascular diseases`                                          |
| `risk`        | IHME risk name, e.g. `High systolic blood pressure`                                      |
| `locations`   | 1 to 10 GBD names, ISO 3166-1 alpha-3 or ISO 3166-2 codes, or GBD ids                    |
| `children_of` | one place: every imported unit directly inside it; inside Global, every imported country |
| `sdi`         | `true`: every imported SDI group                                                         |
| `sex`         | `both`, `male`, `female`                                                                 |
| `age`         | `all_ages`, `age_standardized`, `at_birth`                                               |
| `years`       | 1 to 10 years, 1990 to 2023                                                              |

Give a cause, a risk or both (a risk alone is its burden from all causes), and
exactly one of `locations`, `children_of` or `sdi`. `World` is GBD's
`Global` (id 1), and `children_of` Global gives every imported country rather
than the super-regions, so one call can fill a world map. HALE and life expectancy
(#394) take metric `years` and no cause or risk; `years` and `at_birth` are
theirs only. `at_birth` reads the first imported of GBD age ids 2 (0-6 days)
and 28 (<1 year): GBD 2023 exports HALE and life expectancy by age group, each
group's value at its start age, so the youngest group, which starts at age 0,
is the value at birth.

The measures are listed calm first: living-well measures (HALE, life
expectancy), then DALYs, YLDs, prevalence and incidence, and deaths last. The
tool description tells the model to lead with them and to read deaths only
when the question asks for deaths; see
[clinical-research.md](clinical-research.md#population-estimates-stay-calm). Names are matched without
case or accents. The result carries the attribution, `source: IHME GBD 2023`,
the unit, and one row per location and year with `value`, `lower`, `upper`,
`location_id`, `iso3` and `iso3166_2`, sorted by year and then by value,
largest first. Asked location-year pairs with no estimate are listed in
`not_imported`, never filled.

Up to 250 rows are returned (all 204 countries for one year fit). The model
gets a result of up to 30 rows whole; a longer one would not fit the chat
context, so it gets `n`, the 10 highest and the 5 lowest values and a
`rows_shown` note (`gbdModelOutput`). The map, the explainability panel and
the audit keep every row.

The model's copy of the schema leaves out the string and list bounds and the
year range (zod still enforces them), and the tool offers three age options
only: with one wearable linked the default chat context had about 230 tokens
free, and the tool now takes almost all of them (`bun run prompt:size`, case
"personal, Oura, GBD and VCF imported agent:gp").

Coded refusals (`packages/query-tools/gbd-refusals.ts`), each audited with 0
rows: `GBD_NOT_IMPORTED`, `GBD_UNKNOWN_LOCATION`, `GBD_AMBIGUOUS_LOCATION`
(Georgia the country and the US state; ask with `GEO` or `US-GA`),
`GBD_UNKNOWN_CAUSE` and `GBD_UNKNOWN_RISK` (with the imported names),
`GBD_NO_ESTIMATE`, `GBD_NO_SDI` (no SDI group imported) and
`GBD_TOO_MANY_ROWS` (more than 250 rows; refused, not cut).

Every call goes through `audited()` as `gbd_estimate` with `subject_ref` null.
The tool reads no subject and no personal data and opens no network
connection, so the disclosure ledger has nothing to record. Like
`gbd.gbd_query` it is a reference tool: its rows never make an answer
`sufficient_data`, and they show under "Population context" in the
explainability panel with the GBD 2023 attribution.

Chat checks for imported estimates once per answer
(`features/chat/gbd-local-tool-deps.ts`); a failed check (the migration not
applied) offers nothing. The tool belongs to the "IHME GBD estimates" source,
so turning that source off removes it. It is in the OpenAI tool snapshot, not
in the `mcp:serve` manifest.

### Profiles: `gbd_profile` (#403)

Like IHME's GBD profiles, the `/profile` skill builds one structured answer
about one place or one cause from the local store. Its only tool is
`gbd_profile` (`features/chat/gbd-profile-tool.ts`), which runs a fixed
sequence of `gbd_estimate` calls through the same code as the chat tool, so
each call is audited as `gbd_estimate` with `subject_ref` null and its rows
reach the explainability panel. The model passes `kind` (`location` or
`cause`), the place or the cause, and `deaths: true` only when the question
asks for deaths.

A location profile, in this order:

1. HALE at birth for the place, its parent (a region for a country, the
   country for a state) and Global, for the profile years 1990, 2000, 2010,
   2015, 2019 to 2023; the latest year with a row for the place is the
   profile's year.
2. Life expectancy at birth, the same way.
3. The trend of both for the place, when more than one year is imported.
4. Top causes of DALYs: one call per imported level 2 cause (at most 40 by
   name), age-standardised rate in the profile's year, ranked. See "Cause
   levels" below.
5. HALE for the units inside the place (`children_of` the place), else for its
   neighbours (`children_of` its parent), for the map.
6. With `deaths: true` only: top causes of deaths, as for DALYs.

A cause profile: the world's DALY rate over the profile years
(age-standardised, else all ages); every imported country in the latest year,
ranked (top 10) and mapped by country; the world's rate for females and for
males; with `deaths: true`, the world's death rate over the years. A cause
that is not imported makes one refused call and every section says so.

The sections are assembled by pure functions
(`packages/gbd-local/profile.ts`) and drawn by
`features/chat/gbd-profile-views.ts`: a table of the sections and whether
each is shown or not imported, a table per section with rows (a numbered
list for a ranking; years and rates to one decimal), and a choropleth whose
own audit row is `gbd_profile.map`. A section without imported estimates says
so in one plain sentence ("Life expectancy at birth for Switzerland is not
imported."); it never fails the profile. The model gets each section's
title, status, note and up to 10 rounded rows, and writes the prose from
them. Like `gbd_estimate`, the profile is reference material: its rows never
make an answer `sufficient_data`.

The app, not the model, draws a fixed header and footer around the model's
text (#417), because small models do not reliably write headings or end with
the attribution. The header gives the profile's title ("Location profile:
Switzerland, 2023"), the source (IHME GBD 2023) and the day of the latest
import; the footer gives the attribution line ("Population estimate (IHME GBD
2023), not a statement about this person.") and IHME's citation. The tool
returns them as `frame` in its output, which the model does not see
(`infrastructure/gbd-profile-frame.ts`), and the thread's PDF and Download
exports carry the same lines. The citation is the one `bun run gbd:import`
read from the `citation.txt` next to the imported files (IHME puts one in
each download; it is stored with the file's record in `gbd_imports`), else
IHME's citation for GBD 2023 Results Tool data.

#### Cause levels (#409)

GBD causes form a hierarchy: All causes (level 0); level 1, the three groups
(communicable, maternal, neonatal and nutritional diseases; non-communicable
diseases; injuries); level 2, such as cardiovascular diseases or neoplasms;
then levels 3 and 4. A parent's estimate includes its children's, so ranking
causes of different levels against each other would put a parent above its own
children. A location profile ranks only causes at one level, level 2 by
default (`PROFILE_CAUSE_LEVEL`; `rankableCauses(causes, level)` takes another).
Causes at other levels are left out and counted in the section's note. A
cause whose id the table below does not hold has no known level: it is never
ranked, and the note names it ("Not ranked, level in the GBD cause hierarchy
not known: ...", the first 10 by name). Levels are matched by cause id, which
every "Both" export carries.

`packages/gbd-local/cause-table.ts` holds each cause id with its parent, level
and name; `packages/gbd-local/causes.ts` reads it. `scripts/gbd/build-cause-table.ts`
builds it from `cause.py` of IHME's public, BSD-3-Clause `vivarium-gbd-mapping`
package at a pinned commit
([ihmeuw/vivarium-suite, `libs/gbd-mapping/src/vivarium/gbd_mapping/cause.py`](https://github.com/ihmeuw/vivarium-suite/blob/61376fb6da915e10c7bcc82e2145a2fbe6c2b0b9/libs/gbd-mapping/src/vivarium/gbd_mapping/cause.py)),
which its changelog says was updated for GBD 2023 (5.0.0). The GBD 2023 cause
hierarchy file on the GHDx needs a sign-in, so it is not used. The script
checks that each cause has a parent one level up and stops otherwise.

- 395 causes: All causes, 8 at level 1, 22 at level 2, 178 at level 3 and 186
  at level 4. Five of the level 1 entries are IHME aggregates outside the
  three groups (total cancers, total cancers excluding non-melanoma skin
  cancer, and total burden related to hepatitis B, hepatitis C and NAFLD);
  they are never level 2, so they are not ranked by default.
- Names are the package's snake_case keys (`cardiovascular_diseases`), not
  IHME's display names; the profile shows the imported name.
- Ids, parents, levels and names only, no estimates. A cause the package does
  not list is of unknown level; nothing is guessed.

The tool is built only for a turn whose skill lists it and only when
estimates are imported (`createChatTools`, `skillTools`), so other turns
carry neither its definition nor the skill's text. It is not in the OpenAI
tool snapshot or the `mcp:serve` manifest.

## Remote MCP server

GBD is the entry `gbd` in the MCP server registry (`packages/mcp-client/registry.ts`:
transport `http`, locality `remote`, URL from `GBD_MCP_URL`). `packages/gbd-mcp/client.ts`
only binds that entry and the env to the generic JSON-RPC client in
`packages/mcp-client/http-client.ts`. `permitServerForDataMode` refuses a `remote` entry
in `DATA_MODE=personal`.

### Status

`GET /api/gbd/status` returns:

- `{ configured: false }` when `GBD_MCP_URL` or `GBD_MCP_TOKEN` is unset
- `{ configured: true, state: "ok", tools: [...] }`, with tool **names only**
- `{ configured: true, state: "error" }` when `tools/list` fails

The Connectors card shows those three states. It never shows schemas, results,
or the token. It does not report the local store.

### Chat tool

The model sees `gbd_population` with a closed enum input. If the live MCP tool
is free-text `gbd_query`, the host composes a fixed question from those fields.
Every call is audited as `gbd.gbd_query` with structured args and
`subject_ref` null.

Its rows keep the label `IHME GBD 2021`, the round this connector was built
against; it has not been checked against a live server serving GBD 2023. The
explainability panel names the round its rows carry, so remote rows show
`Population estimate (IHME GBD 2021), not a statement about this person.`

### Live smoke

`RUN_LIVE=1 bun test packages/gbd-mcp/live.test.ts`

Requires `GBD_MCP_URL` and `GBD_MCP_TOKEN` in the local environment. The token
is never logged.

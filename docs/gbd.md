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
2. GBD Estimate: "Cause of death or injury", or "Risk factor" for burden
   attributable to a risk.
3. Measure: any of Deaths, DALYs, YLDs, YLLs, Prevalence, Incidence.
4. Metric: Number, Rate and/or Percent.
5. Cause (and Risk for a risk factor query), Location, Age ("All ages" and/or
   "Age-standardized", the two `gbd_estimate` reads), Sex and Year. To compare
   by SDI, also tick the SDI groups (High SDI to Low SDI) under Location.
6. Click Search, then Download.
7. Choose **Both** (IDs and names), enter an email address and click Submit.
8. Open the "download ready" email, follow the link to the status page and
   download the file or files (they stay there for 7 days). Unzip if needed.
9. Run `bun run gbd:import ~/Downloads/IHME-GBD_2023_DATA-*.csv`.

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
next to or instead of the cause pair. Columns are found by name, so order does
not matter. `val` is the estimate, `upper` and `lower` the 95% uncertainty
interval; an empty bound stays empty, never 0. The parser
(`packages/gbd-local/results-csv.ts`) refuses with a code:

- `GBD_CSV_NAMES_ONLY`, `GBD_CSV_IDS_ONLY`: download again with Both.
- `GBD_CSV_COLUMNS`: not a Results Tool export; the missing columns are named.
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
- ISO 3166-2 for 215 subnational units, checked by hand against the ISO Online
  Browsing Platform (`scripts/gbd/iso-3166-2.ts`): US states and DC, Brazilian
  states, Mexican states, Japanese prefectures, Chinese provinces (Hong Kong
  and Macao also get their own alpha-3, HKG and MAC), Italian regions and
  autonomous provinces, and the four UK nations.
- Every other subnational unit (Ethiopia, India, Indonesia, Iran, Kenya,
  Nigeria, Norway, New Zealand, Pakistan, the Philippines, Poland, Russia,
  Sweden, Ukraine, South Africa, English regions and local authorities) keeps
  its country's alpha-3 and a null ISO 3166-2 code.
- An id the table does not hold, such as a unit GBD 2023 added after the
  source file, is `unmapped`; nothing is guessed. Its rows still import and
  are found by name.

### Tool: `gbd_estimate`

Closed `.strict()` input (`packages/query-tools/gbd-estimate-schema.ts`):

| Field         | Values                                                                |
| ------------- | --------------------------------------------------------------------- |
| `measure`     | `deaths`, `dalys`, `yld`, `yll`, `prevalence`, `incidence`            |
| `metric`      | `number`, `percent`, `rate` (per 100,000)                             |
| `cause`       | IHME cause name, e.g. `Cardiovascular diseases`                       |
| `risk`        | IHME risk name, e.g. `High systolic blood pressure`                   |
| `locations`   | 1 to 10 GBD names, ISO 3166-1 alpha-3 or ISO 3166-2 codes, or GBD ids |
| `children_of` | one place: every imported unit directly inside it                     |
| `sdi`         | `true`: every imported SDI group                                      |
| `sex`         | `both`, `male`, `female`                                              |
| `age`         | `all_ages`, `age_standardized`                                        |
| `years`       | 1 to 10 years, 1990 to 2023                                           |

Give a cause, a risk or both (a risk alone is its burden from all causes), and
exactly one of `locations`, `children_of` or `sdi`. Names are matched without
case or accents. The result carries the attribution, `source: IHME GBD 2023`,
the unit, and one row per location and year with `value`, `lower`, `upper`,
`location_id`, `iso3` and `iso3166_2`, sorted by year and then by value,
largest first. Asked location-year pairs with no estimate are listed in
`not_imported`, never filled.

The model's copy of the schema leaves out the string and list bounds and the
year range (zod still enforces them), and the tool offers two age groups
only: with one wearable linked the default chat context had about 230 tokens
free, and the tool now takes almost all of them (`bun run prompt:size`, case
"personal, Oura, GBD imported agent:gp").

Coded refusals (`packages/query-tools/gbd-refusals.ts`), each audited with 0
rows: `GBD_NOT_IMPORTED`, `GBD_UNKNOWN_LOCATION`, `GBD_AMBIGUOUS_LOCATION`
(Georgia the country and the US state; ask with `GEO` or `US-GA`),
`GBD_UNKNOWN_CAUSE` and `GBD_UNKNOWN_RISK` (with the imported names),
`GBD_NO_ESTIMATE`, `GBD_NO_SDI` (no SDI group imported) and
`GBD_TOO_MANY_ROWS` (more than 200 rows; refused, not cut).

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

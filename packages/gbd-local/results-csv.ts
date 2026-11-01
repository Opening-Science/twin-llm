/**
 * One CSV file from IHME's GBD Results Tool (vizhub.healthdata.org/gbd-results)
 * to estimate rows. Pure.
 *
 * The tool's Download button asks whether the file holds IDs, names or both
 * (GBD Results Tool User Guide, GBD 2023, "Saving and Downloading Results").
 * Only "Both" is read: the ids join a row to the location map and the names
 * are what a question uses. With both, the header is
 *
 *   measure_id, measure_name, location_id, location_name, sex_id, sex_name,
 *   age_id, age_name, cause_id, cause_name, metric_id, metric_name, year,
 *   val, upper, lower
 *
 * and a risk factor export has rei_id, rei_name next to (or instead of) the
 * cause pair. An export of life expectancy or HALE (healthy life
 * expectancy) has neither pair: its rows are about no cause, so cause and
 * risk are optional and such a row has no subject. GBD 2023 exports may
 * start with population_group_id, population_group_name; only "All
 * Population" (id 1) is read, since the store does not key rows by group.
 * Columns are found by name, so their order does not matter. A file in
 * another layout is refused with a code that says which export option to
 * pick; nothing is guessed.
 */
import { parseDelimited } from "@/packages/personal-data/delimited";
import { parsePlainNumber } from "@/packages/personal-data/decimal-text";

export type GbdCsvRow = Readonly<{
  measureId: number;
  measureName: string;
  locationId: number;
  locationName: string;
  sexId: number;
  sexName: string;
  ageId: number;
  ageName: string;
  causeId: number | null;
  causeName: string | null;
  reiId: number | null;
  reiName: string | null;
  metricId: number;
  metricName: string;
  year: number;
  val: number;
  upper: number | null;
  lower: number | null;
}>;

export type GbdCsvError = Readonly<{
  code:
    | "GBD_CSV_UNREADABLE"
    | "GBD_CSV_IDS_ONLY"
    | "GBD_CSV_NAMES_ONLY"
    | "GBD_CSV_COLUMNS"
    | "GBD_CSV_POPULATION_GROUP"
    | "GBD_CSV_ROW";
  message: string;
  /** 1-based line of the file, for GBD_CSV_ROW, GBD_CSV_POPULATION_GROUP and GBD_CSV_UNREADABLE. */
  line?: number;
  missing?: readonly string[];
}>;

export type GbdCsvResult =
  | Readonly<{ ok: true; rows: readonly GbdCsvRow[] }>
  | Readonly<{ ok: false; error: GbdCsvError }>;

const PAIRS = ["measure", "location", "sex", "age", "metric"] as const;
const VALUES = ["year", "val", "upper", "lower"] as const;

/** The columns every "ID and name" export has; the cause and risk pairs are optional. */
export const GBD_REQUIRED_COLUMNS: readonly string[] = [
  ...PAIRS.flatMap((pair) => [`${pair}_id`, `${pair}_name`]),
  ...VALUES,
];

const layoutError = (header: readonly string[]): GbdCsvError | null => {
  const has = (name: string) => header.includes(name);
  if (has("measure") && has("location") && !has("location_id")) {
    return {
      code: "GBD_CSV_NAMES_ONLY",
      message:
        "This file has names only. Download it again and choose Both (IDs and names).",
    };
  }
  if (has("measure_id") && !has("measure_name")) {
    return {
      code: "GBD_CSV_IDS_ONLY",
      message:
        "This file has IDs only. Download it again and choose Both (IDs and names).",
    };
  }
  const missing = [
    ...GBD_REQUIRED_COLUMNS.filter((name) => !has(name)),
    ...(["cause", "rei"] as const).flatMap((pair) =>
      has(`${pair}_id`) === has(`${pair}_name`)
        ? []
        : [has(`${pair}_id`) ? `${pair}_name` : `${pair}_id`],
    ),
  ];
  return missing.length === 0
    ? null
    : {
        code: "GBD_CSV_COLUMNS",
        message: "This is not a GBD Results Tool export with IDs and names.",
        missing,
      };
};

/** The Results Tool's "All Population" group. */
export const GBD_ALL_POPULATION_GROUP = 1;

const int = (raw: string | undefined): number | null => {
  const value = parsePlainNumber(raw);
  return value !== null && Number.isInteger(value) ? value : null;
};

const optionalPair = (
  id: string | undefined,
  name: string | undefined,
): Readonly<{ id: number | null; name: string | null }> | "bad" => {
  if ((id ?? "").trim() === "") return { id: null, name: null };
  const parsed = int(id);
  return parsed === null ? "bad" : { id: parsed, name: (name ?? "").trim() };
};

export const parseGbdResultsCsv = (text: string): GbdCsvResult => {
  const parsed = parseDelimited(text.replace(/^﻿/, ""), ",");
  if (!parsed.ok) {
    return {
      ok: false,
      error: {
        code: "GBD_CSV_UNREADABLE",
        message: "A quoted field is not closed.",
        line: parsed.line,
      },
    };
  }
  const [rawHeader = [], ...body] = parsed.rows;
  const header = rawHeader.map((name) => name.trim().toLowerCase());
  const problem = layoutError(header);
  if (problem !== null) return { ok: false, error: problem };
  const column = (name: string) => header.indexOf(name);
  const rows: GbdCsvRow[] = [];
  for (const [index, cells] of body.entries()) {
    const cell = (name: string): string | undefined => {
      const at = column(name);
      return at === -1 ? undefined : cells[at];
    };
    const group = (cell("population_group_id") ?? "").trim();
    if (group !== "" && int(group) !== GBD_ALL_POPULATION_GROUP) {
      return {
        ok: false,
        error: {
          code: "GBD_CSV_POPULATION_GROUP",
          message:
            "A row is for a population group other than All Population. Download it again with All Population only.",
          line: index + 2,
        },
      };
    }
    const ids = PAIRS.map((pair) => int(cell(`${pair}_id`)));
    const names = PAIRS.map((pair) => (cell(`${pair}_name`) ?? "").trim());
    const year = int(cell("year"));
    const val = parsePlainNumber(cell("val"));
    const cause = optionalPair(cell("cause_id"), cell("cause_name"));
    const rei = optionalPair(cell("rei_id"), cell("rei_name"));
    const upperText = (cell("upper") ?? "").trim();
    const lowerText = (cell("lower") ?? "").trim();
    const upper = upperText === "" ? null : parsePlainNumber(upperText);
    const lower = lowerText === "" ? null : parsePlainNumber(lowerText);
    const [measureId, locationId, sexId, ageId, metricId] = ids;
    const [measureName, locationName, sexName, ageName, metricName] = names;
    if (
      measureId == null ||
      locationId == null ||
      sexId == null ||
      ageId == null ||
      metricId == null ||
      year === null ||
      val === null ||
      cause === "bad" ||
      rei === "bad" ||
      (upperText !== "" && upper === null) ||
      (lowerText !== "" && lower === null)
    ) {
      return {
        ok: false,
        error: {
          code: "GBD_CSV_ROW",
          message: "A row has a missing or non-numeric id, year or value.",
          line: index + 2,
        },
      };
    }
    rows.push({
      measureId,
      measureName: measureName ?? "",
      locationId,
      locationName: locationName ?? "",
      sexId,
      sexName: sexName ?? "",
      ageId,
      ageName: ageName ?? "",
      causeId: cause.id,
      causeName: cause.name,
      reiId: rei.id,
      reiName: rei.name,
      metricId,
      metricName: metricName ?? "",
      year,
      val,
      upper,
      lower,
    });
  }
  return { ok: true, rows };
};

/**
 * The key one estimate is stored under: the same measure, location, sex, age,
 * cause, risk, metric and year from two files is one row. A missing cause or
 * risk is written as `-`.
 */
export const gbdRowKey = (row: GbdCsvRow): string =>
  [
    row.measureId,
    row.locationId,
    row.sexId,
    row.ageId,
    row.causeId ?? "-",
    row.reiId ?? "-",
    row.metricId,
    row.year,
  ].join(":");

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

type RowResult =
  Readonly<{ ok: true; row: GbdCsvRow }> | Readonly<{ ok: false; error: GbdCsvError }>;

/** One data row, by the header's column names; `line` is its 1-based row in the file. */
const rowOf = (
  header: readonly string[],
  cells: readonly string[],
  line: number,
): RowResult => {
  const cell = (name: string): string | undefined => {
    const at = header.indexOf(name);
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
        line,
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
        line,
      },
    };
  }
  return {
    ok: true,
    row: {
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
    },
  };
};

/** A record longer than this is not a Results Tool row; reading stops rather than grow. */
export const GBD_MAX_RECORD_CHARS = 1_000_000;

/**
 * Where the last complete record of `text` ends: the index after its newline,
 * or 0 when there is none yet. `from` and `quoted` resume an earlier scan of
 * the same text, so a long open quote is not scanned again on every chunk.
 */
export const lastRecordEnd = (
  text: string,
  from: number,
  quoted: boolean,
): Readonly<{ end: number; quoted: boolean }> => {
  // As parseDelimited reads quotes: one opens a field only at its start, and
  // inside a quoted field a doubled quote is a quote. A quote that closes and
  // a doubled one look alike until the next character, which both treat the same.
  let inQuote = quoted;
  let end = 0;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (inQuote) {
      if (char === '"') inQuote = false;
      continue;
    }
    if (char === "\n") end = index + 1;
    else if (char === '"') {
      const before = index === 0 ? "\n" : text[index - 1];
      if (before === "," || before === "\n" || before === "\r" || before === '"') {
        inQuote = true;
      }
    }
  }
  return { end, quoted: inQuote };
};

export type GbdCsvChunkResult =
  | Readonly<{ ok: true; rows: readonly GbdCsvRow[] }>
  | Readonly<{ ok: false; error: GbdCsvError }>;

export type GbdCsvReader = Readonly<{
  /** The rows of every record this chunk completes; a record split across chunks waits. */
  push: (chunk: string) => GbdCsvChunkResult;
  /** The rows of the last record, and the layout check when the file had no rows. */
  end: () => GbdCsvChunkResult;
}>;

const UNREADABLE = "A quoted field is not closed.";

/**
 * Reads a Results Tool export a chunk of text at a time (#426), so a file of
 * tens of megabytes never has to be one string. The header is checked as
 * soon as it is complete. After an error the reader answers that error to
 * every later call. The text is held only until its records are complete.
 */
export const createGbdCsvReader = (): GbdCsvReader => {
  // Mutable on purpose: the carried text and scan state between chunks, private to this reader.
  const state: {
    carry: string;
    scanned: number;
    quoted: boolean;
    header: readonly string[] | null;
    rowNumber: number;
    physicalLines: number;
    started: boolean;
    failed: GbdCsvError | null;
  } = {
    carry: "",
    scanned: 0,
    quoted: false,
    header: null,
    rowNumber: 0,
    physicalLines: 0,
    started: false,
    failed: null,
  };

  const fail = (error: GbdCsvError): GbdCsvChunkResult => {
    state.failed = error;
    state.carry = "";
    return { ok: false, error };
  };

  const readRecords = (block: string): GbdCsvChunkResult => {
    const parsed = parseDelimited(block, ",");
    if (!parsed.ok) {
      return fail({
        code: "GBD_CSV_UNREADABLE",
        message: UNREADABLE,
        line: state.physicalLines + parsed.line,
      });
    }
    state.physicalLines += block.split("\n").length - 1;
    const rows: GbdCsvRow[] = [];
    for (const cells of parsed.rows) {
      state.rowNumber += 1;
      if (state.header === null) {
        const header = cells.map((name) => name.trim().toLowerCase());
        const problem = layoutError(header);
        if (problem !== null) return fail(problem);
        state.header = header;
        continue;
      }
      const result = rowOf(state.header, cells, state.rowNumber);
      if (!result.ok) return fail(result.error);
      rows.push(result.row);
    }
    return { ok: true, rows };
  };

  const push = (chunk: string): GbdCsvChunkResult => {
    if (state.failed !== null) return { ok: false, error: state.failed };
    const text = state.carry + (state.started ? chunk : chunk.replace(/^\uFEFF/, ""));
    state.started = true;
    const scan = lastRecordEnd(text, state.scanned, state.quoted);
    if (scan.end === 0) {
      state.carry = text;
      state.scanned = text.length;
      state.quoted = scan.quoted;
      if (text.length > GBD_MAX_RECORD_CHARS) {
        return fail({
          code: "GBD_CSV_UNREADABLE",
          message: UNREADABLE,
          line: state.physicalLines + 1,
        });
      }
      return { ok: true, rows: [] };
    }
    state.carry = text.slice(scan.end);
    state.scanned = state.carry.length;
    state.quoted = scan.quoted;
    return readRecords(text.slice(0, scan.end));
  };

  const end = (): GbdCsvChunkResult => {
    if (state.failed !== null) return { ok: false, error: state.failed };
    const rest = state.carry;
    state.carry = "";
    const read = rest === "" ? ({ ok: true, rows: [] } as const) : readRecords(rest);
    if (!read.ok) return read;
    if (state.header === null) {
      return fail(layoutError([]) ?? { code: "GBD_CSV_COLUMNS", message: "" });
    }
    return read;
  };

  return { push, end };
};

/** A whole file's text at once: the reader with one chunk. */
export const parseGbdResultsCsv = (text: string): GbdCsvResult => {
  const reader = createGbdCsvReader();
  const first = reader.push(text);
  if (!first.ok) return first;
  const last = reader.end();
  if (!last.ok) return last;
  return { ok: true, rows: [...first.rows, ...last.rows] };
};

/** A refusal as one line: code, line and missing columns, as the CLI prints it. */
export const gbdCsvErrorText = (error: GbdCsvError): string => {
  const where = error.line === undefined ? "" : ` (line ${error.line})`;
  const missing =
    error.missing === undefined ? "" : ` Missing: ${error.missing.join(", ")}.`;
  return `${error.code}${where}: ${error.message}${missing}`;
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

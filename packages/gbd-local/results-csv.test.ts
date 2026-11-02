import { describe, expect, test } from "bun:test";

import {
  HALE_EXPORT_HEADER,
  MADE_UP_CAUSE_CSV,
  MADE_UP_HALE_CSV,
  MADE_UP_HEADER,
  MADE_UP_RISK_CSV,
} from "./made-up-results.test-helpers";
import {
  createGbdCsvReader,
  GBD_MAX_RECORD_CHARS,
  type GbdCsvRow,
  gbdCsvErrorText,
  gbdRowKey,
  lastRecordEnd,
  parseGbdResultsCsv,
} from "./results-csv";

/** Made-up rows in the Results Tool layout; the values are not IHME's. */

describe("parseGbdResultsCsv", () => {
  test("reads an ID and name export, CRLF and quoted names", () => {
    const result = parseGbdResultsCsv(`﻿${MADE_UP_CAUSE_CSV}`);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.rows.length).toBe(12);
    expect(result.rows[0]).toEqual({
      measureId: 1,
      measureName: "Deaths",
      locationId: 94,
      locationName: "Switzerland",
      sexId: 3,
      sexName: "Both",
      ageId: 27,
      ageName: "Age-standardized",
      causeId: 491,
      causeName: "Cardiovascular diseases",
      reiId: null,
      reiName: null,
      metricId: 3,
      metricName: "Rate",
      year: 2021,
      val: 100.5,
      upper: 110.25,
      lower: 90.75,
    });
    expect(result.rows[3]?.val).toBe(140);
  });

  test("reads a risk factor export with rei and cause columns in another order", () => {
    const result = parseGbdResultsCsv(MADE_UP_RISK_CSV);
    if (!result.ok) throw new Error(result.error.code);
    expect(
      result.rows.map((row) => [row.reiId, row.reiName, row.causeId, row.val]),
    ).toEqual([
      [107, "High systolic blood pressure", 294, 800],
      [107, "High systolic blood pressure", 491, 600],
    ]);
  });

  test("empty bounds are null, never 0", () => {
    const result = parseGbdResultsCsv(
      `${MADE_UP_HEADER}\n1,Deaths,94,Switzerland,3,Both,27,Age-standardized,491,CVD,3,Rate,2021,5,,`,
    );
    if (!result.ok) throw new Error(result.error.code);
    expect([result.rows[0]?.upper, result.rows[0]?.lower]).toEqual([null, null]);
  });

  test("a names-only export is refused with the option to choose", () => {
    expect(
      parseGbdResultsCsv(
        "measure,location,sex,age,cause,metric,year,val,upper,lower\nDeaths,Switzerland,Both,All ages,CVD,Rate,2021,1,2,0",
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "GBD_CSV_NAMES_ONLY",
        message:
          "This file has names only. Download it again and choose Both (IDs and names).",
      },
    });
  });

  test("an IDs-only export is refused", () => {
    const result = parseGbdResultsCsv(
      "measure_id,location_id,sex_id,age_id,cause_id,metric_id,year,val,upper,lower\n1,94,3,22,491,3,2021,1,2,0",
    );
    expect(result.ok ? null : result.error.code).toBe("GBD_CSV_IDS_ONLY");
  });

  test("another CSV is refused with the missing columns", () => {
    expect(parseGbdResultsCsv("a,b\n1,2")).toEqual({
      ok: false,
      error: {
        code: "GBD_CSV_COLUMNS",
        message: "This is not a GBD Results Tool export with IDs and names.",
        missing: [
          "measure_id",
          "measure_name",
          "location_id",
          "location_name",
          "sex_id",
          "sex_name",
          "age_id",
          "age_name",
          "metric_id",
          "metric_name",
          "year",
          "val",
          "upper",
          "lower",
        ],
      },
    });
  });

  test("reads a HALE export: population group columns, no cause or risk", () => {
    const result = parseGbdResultsCsv(MADE_UP_HALE_CSV);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.rows.length).toBe(4);
    expect(result.rows[0]).toEqual({
      measureId: 28,
      measureName: "HALE (Healthy life expectancy)",
      locationId: 94,
      locationName: "Switzerland",
      sexId: 3,
      sexName: "Both",
      ageId: 2,
      ageName: "0-6 days",
      causeId: null,
      causeName: null,
      reiId: null,
      reiName: null,
      metricId: 5,
      metricName: "Years",
      year: 2023,
      val: 70.25,
      upper: 75.5,
      lower: 60.5,
    });
    expect(gbdRowKey(result.rows[0]!)).toBe("28:94:3:2:-:-:5:2023");
  });

  test("a population group other than All Population is refused with its line", () => {
    const result = parseGbdResultsCsv(
      `${HALE_EXPORT_HEADER}\n2,Pregnant,28,HALE,94,Switzerland,3,Both,2,0-6 days,5,Years,2023,1,2,0`,
    );
    expect(result.ok ? null : [result.error.code, result.error.line]).toEqual([
      "GBD_CSV_POPULATION_GROUP",
      2,
    ]);
  });

  test("half a cause pair is refused with the missing column", () => {
    const result = parseGbdResultsCsv(
      "measure_id,measure_name,location_id,location_name,sex_id,sex_name,age_id,age_name,cause_id,metric_id,metric_name,year,val,upper,lower\n",
    );
    expect(result.ok ? null : result.error.missing).toEqual(["cause_name"]);
  });

  test("a row with a non-numeric value is refused with its line", () => {
    const result = parseGbdResultsCsv(
      `${MADE_UP_HEADER}\n1,Deaths,94,Switzerland,3,Both,27,Age-standardized,491,CVD,3,Rate,2021,1,2,0\n1,Deaths,94,Switzerland,3,Both,27,Age-standardized,491,CVD,3,Rate,2022,n/a,2,0`,
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "GBD_CSV_ROW",
        message: "A row has a missing or non-numeric id, year or value.",
        line: 3,
      },
    });
  });

  test("an unclosed quote is refused", () => {
    expect(parseGbdResultsCsv(`${MADE_UP_HEADER}\n1,"Deaths`)).toEqual({
      ok: false,
      error: {
        code: "GBD_CSV_UNREADABLE",
        message: "A quoted field is not closed.",
        line: 2,
      },
    });
  });
});

describe("gbdRowKey", () => {
  test("joins the ids, with - for a missing cause or risk", () => {
    const cause = parseGbdResultsCsv(MADE_UP_CAUSE_CSV);
    const risk = parseGbdResultsCsv(MADE_UP_RISK_CSV);
    if (!cause.ok || !risk.ok) throw new Error("fixture");
    expect(gbdRowKey(cause.rows[0]!)).toBe("1:94:3:27:491:-:3:2021");
    expect(gbdRowKey(risk.rows[0]!)).toBe("2:94:3:22:294:107:3:2021");
  });
});

const readInChunks = (text: string, size: number) => {
  const reader = createGbdCsvReader();
  const rows: GbdCsvRow[] = [];
  for (let start = 0; start < text.length; start += size) {
    const result = reader.push(text.slice(start, start + size));
    if (!result.ok) return result;
    rows.push(...result.rows);
  }
  const last = reader.end();
  if (!last.ok) return last;
  return { ok: true as const, rows: [...rows, ...last.rows] };
};

describe("createGbdCsvReader (#426)", () => {
  const multiline = `${MADE_UP_HEADER}\r\n1,Deaths,94,"Switzer""land\nwith a break",3,Both,27,Age-standardized,491,CVD,3,Rate,2021,5,6,4\r\n`;

  test("every chunk size reads the same rows as the whole text", () => {
    for (const text of [`﻿${MADE_UP_CAUSE_CSV}`, MADE_UP_HALE_CSV, multiline]) {
      const whole = parseGbdResultsCsv(text);
      for (const size of [1, 2, 3, 7, 64, 1000]) {
        expect(readInChunks(text, size)).toEqual(whole);
      }
    }
  });

  test("a quoted line break split across chunks stays in its field", () => {
    const result = readInChunks(multiline, 5);
    expect(result.ok ? result.rows.map((row) => row.locationName) : null).toEqual([
      'Switzer"land\nwith a break',
    ]);
  });

  test("a wrong header is refused as soon as it is complete, and stays refused", () => {
    const reader = createGbdCsvReader();
    expect(reader.push("a,b")).toEqual({ ok: true, rows: [] });
    const refused = reader.push("\n1,2\n");
    expect(refused.ok ? null : refused.error.code).toBe("GBD_CSV_COLUMNS");
    expect(reader.push(`${MADE_UP_HEADER}\n`)).toEqual(refused);
    expect(reader.end()).toEqual(refused);
  });

  test("a bad row in a later chunk is refused with its line", () => {
    const text = `${MADE_UP_HEADER}\n1,Deaths,94,Switzerland,3,Both,27,All,491,CVD,3,Rate,2021,1,2,0\n1,Deaths,94,Switzerland,3,Both,27,All,491,CVD,3,Rate,2022,x,2,0\n`;
    const result = readInChunks(text, 10);
    expect(result.ok ? null : [result.error.code, result.error.line]).toEqual([
      "GBD_CSV_ROW",
      3,
    ]);
  });

  test("an empty file is refused with every missing column", () => {
    const result = readInChunks("", 10);
    expect(result.ok ? null : result.error.missing?.length).toBe(14);
  });

  test("a record that never ends is refused rather than held", () => {
    const reader = createGbdCsvReader();
    reader.push(`${MADE_UP_HEADER}\n"`);
    const result = reader.push("x".repeat(GBD_MAX_RECORD_CHARS));
    expect(result.ok ? null : [result.error.code, result.error.line]).toEqual([
      "GBD_CSV_UNREADABLE",
      2,
    ]);
  });
});

describe("lastRecordEnd", () => {
  test("ends after the last line break outside quotes", () => {
    expect(lastRecordEnd('a,b\n"c\nd",e\nf', 0, false)).toEqual({
      end: 12,
      quoted: false,
    });
    expect(lastRecordEnd('a\n"b\nc', 0, false)).toEqual({ end: 2, quoted: true });
  });

  test("a quote inside an unquoted field is a plain character, as the parser reads it", () => {
    expect(lastRecordEnd('5",x\ny', 0, false)).toEqual({ end: 5, quoted: false });
  });

  test("resumes inside an open quote", () => {
    expect(lastRecordEnd('ab"\nc', 2, true)).toEqual({ end: 4, quoted: false });
  });
});

describe("gbdCsvErrorText", () => {
  test("code, line and missing columns on one line", () => {
    expect(
      gbdCsvErrorText({
        code: "GBD_CSV_COLUMNS",
        message: "Not an export.",
        missing: ["val", "year"],
      }),
    ).toBe("GBD_CSV_COLUMNS: Not an export. Missing: val, year.");
    expect(gbdCsvErrorText({ code: "GBD_CSV_ROW", message: "Bad row.", line: 4 })).toBe(
      "GBD_CSV_ROW (line 4): Bad row.",
    );
  });
});

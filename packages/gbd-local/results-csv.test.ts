import { describe, expect, test } from "bun:test";

import {
  HALE_EXPORT_HEADER,
  MADE_UP_CAUSE_CSV,
  MADE_UP_HALE_CSV,
  MADE_UP_HEADER,
  MADE_UP_RISK_CSV,
} from "./made-up-results.test-helpers";
import { gbdRowKey, parseGbdResultsCsv } from "./results-csv";

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

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { anchorLayer } from "@/packages/biomarkers/anchor-layer";

import { LAB_TEST_NAMES, lookupLabCode } from "./lab-test-names";
import { parseLabCsv } from "./parse-lab-csv";

const fixture = (name: string): string =>
  readFileSync(
    join(import.meta.dir, "../../tests/fixtures/personal-import", name),
    "utf8",
  );

describe("lookupLabCode: the explicit name table", () => {
  test("every entry names an Anchor marker that is not blocked", () => {
    const missing = Object.keys(LAB_TEST_NAMES).filter((id) => {
      const marker = anchorLayer.biomarkers.find((entry) => entry.id === id);
      return marker === undefined || marker.blocked;
    });
    expect(missing).toEqual([]);
  });

  test("no name is listed for two markers", () => {
    const names = Object.values(LAB_TEST_NAMES).flat();
    expect(names.length).toBe(new Set(names).size);
  });

  test("a listed name in Anchor's unit gets Anchor's code", () => {
    expect(lookupLabCode("HbA1c", "%")).toEqual({
      kind: "coded",
      loinc: "4548-4",
      display: "Hemoglobin A1c/Hemoglobin.total in Blood",
      biomarkerId: "BM-139",
    });
    expect(lookupLabCode("  Total   Cholesterol ", "mg/dL")).toEqual({
      kind: "coded",
      loinc: "2093-3",
      display: "Cholesterol [Mass/volume] in Serum or Plasma",
      biomarkerId: "BM-072",
    });
  });

  test("a convertible unit fits: g/L for a mg/dL marker, 10*3/uL for 10*9/L", () => {
    expect(lookupLabCode("total cholesterol", "g/L")).toMatchObject({ loinc: "2093-3" });
    expect(lookupLabCode("Platelets", "10*3/uL")).toMatchObject({ loinc: "777-3" });
  });

  test("a unit of another property gets no code (moles against mass)", () => {
    expect(lookupLabCode("Total cholesterol", "mmol/L")).toEqual({
      kind: "unit-mismatch",
      biomarkerId: "BM-072",
      expectedUnit: "mg/dL",
    });
  });

  test("fractions must match exactly: HbA1c in mmol/mol is another code", () => {
    expect(lookupLabCode("HbA1c", "mmol/mol")).toEqual({
      kind: "unit-mismatch",
      biomarkerId: "BM-139",
      expectedUnit: "%",
    });
  });

  test("a unit that is not UCUM gets no code", () => {
    expect(lookupLabCode("Platelets", "x10^9/L")).toEqual({
      kind: "unit-mismatch",
      biomarkerId: "BM-427",
      expectedUnit: "10*9/L",
    });
  });

  test("ambiguous and unknown names get no code: no guessing", () => {
    expect(lookupLabCode("Glucose", "mg/dL")).toEqual({ kind: "unknown-name" });
    expect(lookupLabCode("CRP", "mg/L")).toEqual({ kind: "unknown-name" });
    expect(lookupLabCode("LDL", "mg/dL")).toEqual({ kind: "unknown-name" });
    expect(lookupLabCode("HbA1c (lab 2)", "%")).toEqual({ kind: "unknown-name" });
  });

  test("a marker Anchor blocks never maps, even by its own name", () => {
    expect(lookupLabCode("Kupfer", "ug/L")).toEqual({ kind: "unknown-name" });
  });
});

describe("parseLabCsv", () => {
  const parsed = parseLabCsv(fixture("lab-results.csv"));

  test("stores numbers with units as written and codes only from the table or the file", () => {
    if (!parsed.ok || parsed.kind !== "lab-csv") throw new Error("expected lab rows");
    expect(
      parsed.observations.map((row) => [
        row.sourceRef,
        row.code,
        row.display,
        row.value,
        row.unit,
        row.unitUcum,
        row.effectiveAt.toISOString(),
        row.effectivePrecision,
      ]),
    ).toEqual([
      ["row 2", "4548-4", "HbA1c", 5.4, "%", true, "2024-02-10T00:00:00.000Z", "day"],
      [
        "row 3",
        "2093-3",
        "Total cholesterol",
        182,
        "mg/dL",
        true,
        "2024-02-10T00:00:00.000Z",
        "day",
      ],
      [
        "row 4",
        null,
        "Total cholesterol",
        4.7,
        "mmol/L",
        true,
        "2024-02-10T00:00:00.000Z",
        "day",
      ],
      [
        "row 5",
        "2276-4",
        "Ferritin",
        48,
        "ng/mL",
        true,
        "2024-02-10T00:00:00.000Z",
        "day",
      ],
      [
        "row 6",
        "2345-7",
        "Glucose",
        92,
        "mg/dL",
        true,
        "2024-02-10T00:00:00.000Z",
        "day",
      ],
      [
        "row 7",
        null,
        "Made-up marker",
        1.25,
        "U/L",
        true,
        "2024-02-10T00:00:00.000Z",
        "day",
      ],
      [
        "row 8",
        "3016-3",
        "TSH",
        2.1,
        "m[IU]/L",
        true,
        "2025-05-20T06:30:00.000Z",
        "instant",
      ],
      [
        "row 13",
        null,
        "Platelets, count",
        250,
        "x10^9/L",
        false,
        "2025-05-20T00:00:00.000Z",
        "day",
      ],
      [
        "row 14",
        "777-3",
        "Platelets",
        250,
        "10*9/L",
        true,
        "2025-05-20T00:00:00.000Z",
        "day",
      ],
    ]);
    expect(parsed.observations[0]!.note).toBe("made-up");
    expect(parsed.observations[1]!.note).toBeNull();
  });

  test("reports rows it cannot store, with the reason", () => {
    expect(parsed.ok ? parsed.unmapped : null).toEqual([
      {
        where: "row 9",
        code: "not-a-number",
        reason: "has a value that is not a plain number",
      },
      { where: "row 10", code: "no-unit", reason: "has no unit" },
      {
        where: "row 11",
        code: "date-no-time-zone",
        reason:
          "has a time without a time zone; write the day only (2024-03-01) or add Z or +01:00",
      },
      {
        where: "row 12",
        code: "bad-loinc",
        reason: "has a LOINC code that is not well formed",
      },
    ]);
  });

  test("notes the uncoded names and the unit that did not fit", () => {
    expect(parsed.ok ? parsed.notes : null).toEqual([
      "3 test names are not in the LOINC name table; those rows keep their name with no code.",
      "1 row has a known test name in a unit that does not fit its LOINC code, so no code was given.",
    ]);
  });

  test("a header without the four columns is refused, naming what is missing", () => {
    expect(parseLabCsv("date,name,value\n2024-01-01,x,1\n")).toEqual({
      ok: false,
      refusal: {
        code: "missing-columns",
        message:
          "The header needs the columns date, test, value and unit; missing: test, unit.",
      },
    });
  });

  test("a header alone is refused as empty", () => {
    expect(parseLabCsv("date,test,value,unit\n")).toEqual({
      ok: false,
      refusal: { code: "empty", message: "The file has no rows under its header." },
    });
  });

  test("a row with a different field count is reported, never padded", () => {
    const short = parseLabCsv("date,test,value,unit\n2024-01-01,HbA1c,5.4\n");
    expect(short.ok ? short.unmapped : null).toEqual([
      { where: "row 2", code: "field-count", reason: "has 3 fields; the header has 4" },
    ]);
  });

  test("an empty value is missing, not zero", () => {
    const empty = parseLabCsv("date,test,value,unit\n2024-01-01,HbA1c,,%\n");
    expect(empty.ok && empty.kind === "lab-csv" ? empty.observations : null).toEqual([]);
    expect(empty.ok ? empty.unmapped : null).toEqual([
      { where: "row 2", code: "no-value", reason: "has no value" },
    ]);
  });
});

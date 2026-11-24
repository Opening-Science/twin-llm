import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { anchorLayer } from "@/packages/biomarkers/anchor-layer";
import { isLoincCode } from "@/packages/personal-data/loinc-code";
import { MEASURES } from "@/packages/personal-data/wearable-measure-codes";
import { COHORT_MEASURE_NAMES } from "@/packages/warehouse/cohort-measure-names";

import {
  measureCandidates,
  measureCatalogue,
  measureSuggestions,
  needsReadings,
  normaliseMeasureName,
  QUERY_MEASURE_NAMES,
  resolveMeasures,
} from "./measure-names";

/** Codes some other table of the repo already names: the query names add none. */
const KNOWN_CODES = new Set([
  ...COHORT_MEASURE_NAMES.keys(),
  ...anchorLayer.biomarkers.map((marker) => marker.loincCode),
  ...Object.values(MEASURES).flatMap((measure) =>
    measure.code === null ? [] : [measure.code],
  ),
]);

const COHORT_CODES: readonly string[] = JSON.parse(
  readFileSync(join(import.meta.dir, "../../evaluation/cohort-codes.v1.json"), "utf8"),
).codes;

const heldAre =
  (codes: readonly string[]) =>
  async (asked: readonly string[]): Promise<ReadonlySet<string>> =>
    new Set(asked.filter((code) => codes.includes(code)));

const neverAsked = async (): Promise<ReadonlySet<string>> => {
  throw new Error("held codes asked for a name with one code");
};

describe("the measure name table", () => {
  test("every code in it passes the LOINC check digit", () => {
    const codes = [...measureCatalogue().codesByName.values()].flat();
    expect(codes.filter((code) => !isLoincCode(code))).toEqual([]);
  });

  test("the query names use only codes another table already names", () => {
    const codes = Object.values(QUERY_MEASURE_NAMES).flat();
    expect(codes.filter((code) => !KNOWN_CODES.has(code))).toEqual([]);
  });

  test("every code of the pinned cohort is reached by its own short name", () => {
    const named = [...COHORT_MEASURE_NAMES].filter(([code]) =>
      COHORT_CODES.includes(code),
    );
    const missed = named.filter(
      ([code, name]) => !measureCandidates(name).some((entry) => entry.loinc === code),
    );
    expect(named.length).toBeGreaterThan(50);
    expect(missed).toEqual([]);
  });

  test("names in German and English, any case, hyphen or umlaut spelling", () => {
    const codesOf = (name: string) => measureCandidates(name).map((entry) => entry.loinc);
    expect(codesOf("HbA1c")).toEqual(["4548-4"]);
    expect(codesOf("hba1c")).toEqual(["4548-4"]);
    expect(codesOf("  Glycated   Haemoglobin ")).toEqual(["4548-4"]);
    expect(codesOf("Hämoglobin")).toEqual(["718-7"]);
    expect(codesOf("haemoglobin")).toEqual(["718-7"]);
    expect(codesOf("HDL-Cholesterin")).toEqual(["2085-9"]);
    expect(codesOf("hdl cholesterin")).toEqual(["2085-9"]);
    expect(codesOf("Systolic blood pressure")).toEqual(["8480-6"]);
    expect(codesOf("Kalium")).toEqual(["2823-3"]);
    expect(normaliseMeasureName("Körper_Größe")).toBe("koerper groesse");
  });

  test("names that fit several codes keep them all, in code order", () => {
    expect(measureCandidates("LDL cholesterol").map((entry) => entry.loinc)).toEqual([
      "2089-1",
      "18262-6",
    ]);
    expect(measureCandidates("glucose").map((entry) => entry.loinc)).toEqual([
      "1558-6",
      "2339-0",
      "2345-7",
    ]);
    expect(measureCandidates("blood pressure").map((entry) => entry.loinc)).toEqual([
      "8462-4",
      "8480-6",
    ]);
    expect(needsReadings(["HbA1c"])).toBe(false);
    expect(needsReadings(["HbA1c", "LDL"])).toBe(true);
  });

  test("no guessing from parts of a name", () => {
    expect(measureCandidates("LDL level")).toEqual([]);
    expect(measureCandidates("cholesterol LDL")).toEqual([]);
    expect(measureCandidates("A1")).toEqual([]);
    expect(measureCandidates("")).toEqual([]);
  });

  test("suggestions share a word with the name, one per set of codes, at most 8", () => {
    expect(measureSuggestions("LDL level").map((entry) => entry.measure)).toEqual([
      "LDL",
    ]);
    expect(measureSuggestions("skin temperature").map((entry) => entry.measure)).toEqual([
      "Body temperature",
    ]);
    expect(measureSuggestions("blood").length).toBe(8);
    expect(measureSuggestions("xy")).toEqual([]);
  });
});

describe("resolveMeasures", () => {
  test("a name with one code needs no readings", async () => {
    expect(await resolveMeasures({ loinc: [], measure: ["HbA1c"] }, neverAsked)).toEqual({
      codes: ["4548-4"],
      resolved: [
        {
          measure: "HbA1c",
          loinc: "4548-4",
          name: "Hemoglobin A1c/Hemoglobin.total in Blood",
        },
      ],
    });
  });

  test("LDL: the one code the subject has readings of", async () => {
    const result = await resolveMeasures(
      { loinc: [], measure: ["LDL cholesterol"] },
      heldAre(["18262-6", "2093-3"]),
    );
    expect(result).toEqual({
      codes: ["18262-6"],
      resolved: [
        { measure: "LDL cholesterol", loinc: "18262-6", name: "LDL cholesterol" },
      ],
    });
  });

  test("glucose with blood and plasma readings both: refused with the candidates", async () => {
    expect(
      await resolveMeasures(
        { loinc: [], measure: ["glucose"] },
        heldAre(["2339-0", "2345-7"]),
      ),
    ).toEqual({
      code: "AMBIGUOUS_MEASURE",
      error:
        "this name fits more than one code with readings; call again with the loinc of the one meant, or ask which is meant",
      measure: "glucose",
      candidates: [
        {
          loinc: "1558-6",
          name: "Fasting glucose [Mass/volume] in Serum or Plasma",
          has_readings: false,
        },
        { loinc: "2339-0", name: "Blood glucose", has_readings: true },
        { loinc: "2345-7", name: "Glucose", has_readings: true },
      ],
    });
  });

  test("a name whose codes have no readings at all says so, and picks none", async () => {
    const result = await resolveMeasures(
      { loinc: [], measure: ["creatinine"] },
      heldAre([]),
    );
    expect(result).toMatchObject({
      code: "AMBIGUOUS_MEASURE",
      error:
        "this name fits more than one code and none has a reading here; say there is no reading under this name",
    });
  });

  test("held codes are asked once, for the ambiguous names' candidates only", async () => {
    const asked: (readonly string[])[] = [];
    await resolveMeasures(
      { loinc: [], measure: ["HbA1c", "LDL", "sodium"] },
      async (codes) => {
        asked.push(codes);
        return new Set(["18262-6", "2947-0"]);
      },
    );
    expect(asked).toEqual([["2089-1", "18262-6", "2947-0", "2951-2"]]);
  });

  test("codes and names together: given codes first, each code once", async () => {
    expect(
      await resolveMeasures(
        { loinc: ["8480-6", "4548-4"], measure: ["HbA1c", "BMI"] },
        neverAsked,
      ),
    ).toMatchObject({ codes: ["8480-6", "4548-4", "39156-5"] });
  });

  test("a measure written as a code is read as one, check digit and all", async () => {
    expect(
      await resolveMeasures({ loinc: [], measure: [" 4548-4", "HbA1c"] }, neverAsked),
    ).toMatchObject({ codes: ["4548-4"] });
    expect(
      await resolveMeasures({ loinc: [], measure: ["4548-5"] }, neverAsked),
    ).toMatchObject({ code: "INVALID_LOINC", loinc: ["4548-5"] });
  });

  test("a code failing the check digit is refused before any name is looked at", async () => {
    expect(
      await resolveMeasures(
        { loinc: ["4548-4", "2335-1", "8300-0"], measure: ["no such thing"] },
        neverAsked,
      ),
    ).toEqual({
      code: "INVALID_LOINC",
      error:
        "not a LOINC code (its check digit is wrong), so nothing was read; name the measure in measure instead",
      loinc: ["2335-1", "8300-0"],
    });
  });

  test("an unknown name is refused with suggestions, before readings are asked", async () => {
    expect(
      await resolveMeasures({ loinc: [], measure: ["LDL", "LDL level"] }, neverAsked),
    ).toEqual({
      code: "UNKNOWN_MEASURE",
      error:
        "no measure of this name is known; call again with a suggestion only if it is the measure meant, otherwise say this measure is not recorded",
      measure: "LDL level",
      suggestions: [{ measure: "LDL", loinc: ["2089-1", "18262-6"] }],
    });
  });

  test("an unknown name with nothing alike says so plainly", async () => {
    expect(
      await resolveMeasures({ loinc: [], measure: ["Oura readiness"] }, neverAsked),
    ).toMatchObject({
      code: "UNKNOWN_MEASURE",
      error:
        "no measure of this name is known; name it another way, or give its LOINC code",
      suggestions: [],
    });
  });
});

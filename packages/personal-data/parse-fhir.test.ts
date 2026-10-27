import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { parseFhir } from "./parse-fhir";

const fixture = (name: string): string =>
  readFileSync(
    join(import.meta.dir, "../../tests/fixtures/personal-import", name),
    "utf8",
  );

const bundle = fixture("fhir-bundle.json");

describe("parseFhir", () => {
  const parsed = parseFhir(bundle);
  if (!parsed.ok || parsed.kind !== "fhir") throw new Error("expected FHIR rows");

  test("numbers with unit and date; panel components become their own rows", () => {
    expect(
      parsed.observations.map((row) => [
        row.sourceRef,
        row.codeSystem,
        row.code,
        row.display,
        row.value,
        row.unit,
        row.unitUcum,
        row.effectiveAt.toISOString(),
        row.effectivePrecision,
      ]),
    ).toEqual([
      [
        "f0000000-0000-4000-8000-000000000002",
        "http://loinc.org",
        "4548-4",
        "Hemoglobin A1c/Hemoglobin.total in Blood",
        5.4,
        "%",
        true,
        "2024-02-10T08:30:00.000Z",
        "instant",
      ],
      [
        "f0000000-0000-4000-8000-000000000003#8480-6",
        "http://loinc.org",
        "8480-6",
        "Systolic blood pressure",
        121,
        "mm[Hg]",
        true,
        "2025-06-01T09:00:00.000Z",
        "instant",
      ],
      [
        "f0000000-0000-4000-8000-000000000003#8462-4",
        "http://loinc.org",
        "8462-4",
        "Diastolic blood pressure",
        79,
        "mm[Hg]",
        true,
        "2025-06-01T09:00:00.000Z",
        "instant",
      ],
      // No UCUM system on the Quantity: the unit is kept as written and checked.
      [
        "f0000000-0000-4000-8000-000000000004",
        "http://loinc.org",
        "2339-0",
        "Glucose [Mass/volume] in Blood",
        92,
        "mg/dL",
        true,
        "2024-02-10T08:30:00.000Z",
        "instant",
      ],
    ]);
  });

  test("conditions are kept as recorded", () => {
    expect(parsed.clinical).toEqual([
      {
        resourceType: "Condition",
        codeSystem: "http://snomed.info/sct",
        code: "444814009",
        display: "Viral sinusitis (disorder)",
        startAt: new Date("2023-11-02T00:00:00Z"),
        endAt: new Date("2023-11-20T00:00:00Z"),
        status: "resolved",
        sourceRef: "f0000000-0000-4000-8000-000000000007",
      },
    ]);
  });

  test("coded answers and numbers without a unit are reported", () => {
    expect(parsed.unmapped).toEqual([
      {
        where: "Observation f0000000-0000-4000-8000-000000000005",
        code: "not-a-number",
        reason: "has a text or coded answer; this version stores numbers only",
      },
      {
        where: "Observation f0000000-0000-4000-8000-000000000006",
        code: "no-unit",
        reason: "has a number without a unit",
      },
    ]);
  });

  test("the Patient is never stored, and says so", () => {
    expect(parsed.notes).toEqual([
      "The Patient resource is not stored: no name, identifier or birth date is kept.",
    ]);
    expect(JSON.stringify(parsed)).not.toContain("Made-up");
    expect(JSON.stringify(parsed)).not.toContain("1970-01-01");
  });

  test("NDJSON reads like a bundle; other resource types are counted", () => {
    const lines = [
      JSON.stringify({
        resourceType: "Observation",
        id: "n1",
        status: "final",
        code: {
          coding: [
            { system: "http://loinc.org", code: "29463-7", display: "Body weight" },
          ],
        },
        effectiveDateTime: "2024-03",
        valueQuantity: {
          value: 70.5,
          unit: "kg",
          system: "http://unitsofmeasure.org",
          code: "kg",
        },
      }),
      JSON.stringify({
        resourceType: "Encounter",
        id: "e1",
        status: "finished",
        class: {
          system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
          code: "AMB",
        },
      }),
    ].join("\n");
    const ndjson = parseFhir(lines);
    expect(
      ndjson.ok && ndjson.kind === "fhir"
        ? ndjson.observations.map((row) => [
            row.code,
            row.value,
            row.unit,
            row.effectivePrecision,
          ])
        : null,
    ).toEqual([["29463-7", 70.5, "kg", "month"]]);
    expect(ndjson.ok ? ndjson.notes : null).toEqual([
      "Resources of other types are not stored in this version: Encounter 1.",
    ]);
  });

  test("a unit that is not UCUM is kept as written and marked", () => {
    const single = parseFhir(
      JSON.stringify({
        resourceType: "Observation",
        id: "s1",
        status: "final",
        code: { text: "Steps" },
        effectiveDateTime: "2024-05-01",
        valueQuantity: { value: 8000, unit: "steps" },
      }),
    );
    expect(single.ok && single.kind === "fhir" ? single.observations : null).toEqual([
      {
        codeSystem: null,
        code: null,
        display: "Steps",
        value: 8000,
        unit: "steps",
        unitUcum: false,
        effectiveAt: new Date("2024-05-01T00:00:00Z"),
        effectivePrecision: "day",
        sourceRef: "s1",
        note: null,
      },
    ]);
  });

  test("a resource that fails open-twin's structure checks refuses the file", () => {
    // Encounter.class is required in R4.
    expect(
      parseFhir(
        JSON.stringify({ resourceType: "Encounter", id: "e1", status: "finished" }),
      ),
    ).toEqual({
      ok: false,
      refusal: {
        code: "fhir-invalid",
        message:
          "The bundle did not pass the FHIR R4 structure checks (rule ot-missing-required-element).",
      },
    });
  });

  test("not JSON, not FHIR and empty bundles are refused with a sentence", () => {
    expect(parseFhir("date,test\n")).toEqual({
      ok: false,
      refusal: { code: "not-json", message: "The file is not JSON or NDJSON." },
    });
    expect(parseFhir('{"hello": 1}')).toEqual({
      ok: false,
      refusal: {
        code: "not-fhir",
        message: "The file is not a FHIR Bundle or FHIR resources.",
      },
    });
    expect(
      parseFhir('{"resourceType": "Bundle", "type": "collection", "entry": []}'),
    ).toEqual({
      ok: false,
      refusal: { code: "empty", message: "The bundle has no resources." },
    });
  });
});

import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";

import { CONVERSIONS, numberSources } from "@/infrastructure/number-sources";

import type { QueryToolPorts } from "./ports";
import { unsupportedConversion } from "./refusals";
import { convertUnitInput } from "./schemas";
import type { SessionScope } from "./scope";
import { runConvertUnit } from "./tools";
import {
  applyConversion,
  CONVERSION_ANALYTES,
  CONVERSION_TABLE,
  type ConversionAnalyte,
  type ConversionUnit,
  findConversion,
} from "./unit-conversions";

/**
 * `convert_unit` over synthetic values. Every expected value is written out
 * and computed by hand from the formula in the table, never by calling the
 * code under test.
 */

const rule = (analyte: ConversionAnalyte, from: ConversionUnit, to: ConversionUnit) => {
  const found = findConversion(analyte, from, to);
  if (found === null) throw new Error(`no rule ${analyte} ${from} → ${to}`);
  return found;
};

type Case = Readonly<{
  analyte: ConversionAnalyte;
  from: ConversionUnit;
  to: ConversionUnit;
  input: number;
  value: number;
  unrounded: number;
  formula: string;
  decimals: number;
}>;

/** Each pair, both directions. `unrounded` is the double the formula gives. */
const CASES: readonly Case[] = [
  // 126 ÷ 18.016 = 6.99378…
  {
    analyte: "glucose",
    from: "mg/dL",
    to: "mmol/L",
    input: 126,
    value: 7,
    unrounded: 6.9937833037300186,
    formula: "mmol/L = mg/dL ÷ 18.016",
    decimals: 1,
  },
  // 5.5 × 18.016 = 99.088
  {
    analyte: "glucose",
    from: "mmol/L",
    to: "mg/dL",
    input: 5.5,
    value: 99,
    unrounded: 99.088,
    formula: "mg/dL = mmol/L × 18.016",
    decimals: 0,
  },
  // 1.2 × 88.42 = 106.104
  {
    analyte: "creatinine",
    from: "mg/dL",
    to: "umol/L",
    input: 1.2,
    value: 106,
    unrounded: 106.104,
    formula: "umol/L = mg/dL × 88.42",
    decimals: 0,
  },
  // 106 ÷ 88.42 = 1.19882…
  {
    analyte: "creatinine",
    from: "umol/L",
    to: "mg/dL",
    input: 106,
    value: 1.2,
    unrounded: 1.1988237955213752,
    formula: "mg/dL = umol/L ÷ 88.42",
    decimals: 2,
  },
  // (6.5 − 2.15) × 10.929 = 4.35 × 10.929 = 47.54115
  {
    analyte: "hba1c",
    from: "%",
    to: "mmol/mol",
    input: 6.5,
    value: 48,
    unrounded: 47.541149999999995,
    formula: "mmol/mol = (% − 2.15) × 10.929",
    decimals: 0,
  },
  // 48 ÷ 10.929 + 2.15 = 4.39198… + 2.15
  {
    analyte: "hba1c",
    from: "mmol/mol",
    to: "%",
    input: 48,
    value: 6.5,
    unrounded: 6.541984628053802,
    formula: "% = mmol/mol ÷ 10.929 + 2.15",
    decimals: 1,
  },
  // 200 ÷ 38.67 = 5.17196…
  {
    analyte: "total_cholesterol",
    from: "mg/dL",
    to: "mmol/L",
    input: 200,
    value: 5.17,
    unrounded: 5.17196793379881,
    formula: "mmol/L = mg/dL ÷ 38.67",
    decimals: 2,
  },
  // 5.17 × 38.67 = 199.9239
  {
    analyte: "total_cholesterol",
    from: "mmol/L",
    to: "mg/dL",
    input: 5.17,
    value: 200,
    unrounded: 199.9239,
    formula: "mg/dL = mmol/L × 38.67",
    decimals: 0,
  },
  // 130 ÷ 38.67 = 3.36177…
  {
    analyte: "ldl_cholesterol",
    from: "mg/dL",
    to: "mmol/L",
    input: 130,
    value: 3.36,
    unrounded: 3.361779156969227,
    formula: "mmol/L = mg/dL ÷ 38.67",
    decimals: 2,
  },
  // 3.36 × 38.67 = 129.9312
  {
    analyte: "ldl_cholesterol",
    from: "mmol/L",
    to: "mg/dL",
    input: 3.36,
    value: 130,
    unrounded: 129.9312,
    formula: "mg/dL = mmol/L × 38.67",
    decimals: 0,
  },
  // 50 ÷ 38.67 = 1.29299…
  {
    analyte: "hdl_cholesterol",
    from: "mg/dL",
    to: "mmol/L",
    input: 50,
    value: 1.29,
    unrounded: 1.2929919834497026,
    formula: "mmol/L = mg/dL ÷ 38.67",
    decimals: 2,
  },
  // 1.29 × 38.67 = 49.8843
  {
    analyte: "hdl_cholesterol",
    from: "mmol/L",
    to: "mg/dL",
    input: 1.29,
    value: 50,
    unrounded: 49.8843,
    formula: "mg/dL = mmol/L × 38.67",
    decimals: 0,
  },
  // 150 ÷ 88.57 = 1.69357…
  {
    analyte: "triglycerides",
    from: "mg/dL",
    to: "mmol/L",
    input: 150,
    value: 1.69,
    unrounded: 1.693575702833917,
    formula: "mmol/L = mg/dL ÷ 88.57",
    decimals: 2,
  },
  // 1.69 × 88.57 = 149.6833
  {
    analyte: "triglycerides",
    from: "mmol/L",
    to: "mg/dL",
    input: 1.69,
    value: 150,
    unrounded: 149.68329999999997,
    formula: "mg/dL = mmol/L × 88.57",
    decimals: 0,
  },
  // 37 × 9/5 + 32 = 98.6
  {
    analyte: "body_temperature",
    from: "Cel",
    to: "[degF]",
    input: 37,
    value: 98.6,
    unrounded: 98.6,
    formula: "[degF] = Cel × 9/5 + 32",
    decimals: 1,
  },
  // (98.6 − 32) × 5/9 = 37
  {
    analyte: "body_temperature",
    from: "[degF]",
    to: "Cel",
    input: 98.6,
    value: 37,
    unrounded: 37,
    formula: "Cel = ([degF] − 32) × 5/9",
    decimals: 1,
  },
];

const roundingText = (decimals: number): string =>
  `half away from zero to ${decimals} decimal${decimals === 1 ? "" : "s"}`;

describe("the conversion table", () => {
  test("every pair, both directions: exact value, unrounded value, formula and rounding", () => {
    for (const item of CASES) {
      expect({
        pair: `${item.analyte} ${item.from} → ${item.to}`,
        ...applyConversion(rule(item.analyte, item.from, item.to), item.input),
      }).toEqual({
        pair: `${item.analyte} ${item.from} → ${item.to}`,
        value: item.value,
        unrounded: item.unrounded,
        formula: item.formula,
        rounding: roundingText(item.decimals),
      });
    }
  });

  test("the cases above are the whole table, one rule per direction", () => {
    const pairs = (list: readonly { analyte: string; from: string; to: string }[]) =>
      list.map((item) => `${item.analyte} ${item.from} → ${item.to}`).sort();
    expect(pairs(CONVERSION_TABLE)).toEqual(pairs(CASES));
    expect(new Set(pairs(CONVERSION_TABLE)).size).toBe(CONVERSION_TABLE.length);
    expect(new Set(CONVERSION_TABLE.map((item) => item.analyte))).toEqual(
      new Set(CONVERSION_ANALYTES),
    );
  });

  test("rounding is half away from zero on the decimal value", () => {
    // 36.75 × 9/5 + 32 = 98.15 → 98.2; 0.25 °C = 32.45 °F → 32.5.
    expect(applyConversion(rule("body_temperature", "Cel", "[degF]"), 36.75)).toEqual({
      value: 98.2,
      unrounded: 98.15,
      formula: "[degF] = Cel × 9/5 + 32",
      rounding: roundingText(1),
    });
    expect(applyConversion(rule("body_temperature", "Cel", "[degF]"), 0.25).value).toBe(
      32.5,
    );
    // Below zero it rounds away from zero: 0 °F = −17.777… °C → −17.8.
    expect(applyConversion(rule("body_temperature", "[degF]", "Cel"), 0).value).toBe(
      -17.8,
    );
    // HbA1c 2 % is below the equation's intercept: (2 − 2.15) × 10.929 = −1.63935 → −2.
    expect(applyConversion(rule("hba1c", "%", "mmol/mol"), 2).value).toBe(-2);
    // −40 is the same in both scales.
    expect(applyConversion(rule("body_temperature", "Cel", "[degF]"), -40).value).toBe(
      -40,
    );
  });

  test("a pair that is not in the table has no rule", () => {
    expect(findConversion("hba1c", "%", "mmol/L")).toBeNull();
    expect(findConversion("creatinine", "mg/dL", "mmol/L")).toBeNull();
    expect(findConversion("glucose", "mg/dL", "mg/dL")).toBeNull();
  });
});

describe("one table for the tool, the matcher and the scorer", () => {
  test("the matcher converts every pair of the table with the table's own function", () => {
    for (const item of CONVERSION_TABLE) {
      expect(CONVERSIONS.some((conversion) => conversion.convert === item.convert)).toBe(
        true,
      );
    }
  });

  test("a creatinine row in mg/dL sources the same reading narrated in µmol/L", () => {
    const part = {
      toolCallId: "1",
      input: { loinc: ["38483-4"] },
      output: {
        rows: [
          { loinc: "38483-4", value: 1.2, unit_ucum: "mg/dL", effective: "2025-03-01" },
        ],
      },
    };
    expect(numberSources("Creatinine was 106 µmol/L.", [part])).toEqual([
      { text: "106", start: 15, end: 18, toolCallId: "1", rowIndex: 0, field: "value" },
    ]);
  });
});

describe("convertUnitInput", () => {
  test("is closed: enums for analyte and units, no other keys", () => {
    const ok = { value: 126, from: "mg/dL", to: "mmol/L", analyte: "glucose" };
    expect(convertUnitInput.safeParse(ok).success).toBe(true);
    expect(convertUnitInput.safeParse({ ...ok, analyte: "sodium" }).success).toBe(false);
    expect(convertUnitInput.safeParse({ ...ok, to: "mmol/dL" }).success).toBe(false);
    expect(convertUnitInput.safeParse({ ...ok, subject_ref: "s" }).success).toBe(false);
    expect(convertUnitInput.safeParse({ ...ok, value: Number.NaN }).success).toBe(false);
  });
});

const fakePorts = () => {
  const audits: AppendInput[] = [];
  const reads: string[] = [];
  const ports: QueryToolPorts = {
    findSubject: async (subjectRef) => {
      reads.push(`subject ${subjectRef}`);
      return null;
    },
    findObservations: async () => {
      reads.push("observations");
      return [];
    },
    appendAudit: async (input) => {
      audits.push(input);
    },
  };
  return { ports, audits, reads };
};

const synthetic: SessionScope = { actor: "local", sessionId: "turn", mode: "synthetic" };
const personal: SessionScope = { actor: "local", sessionId: "turn", mode: "personal" };

const GLUCOSE = { value: 126, from: "mg/dL", to: "mmol/L", analyte: "glucose" } as const;

describe("convert_unit", () => {
  test("126 mg/dL glucose: exact output, audited with no subject and 0 rows, no read", async () => {
    const { ports, audits, reads } = fakePorts();
    const result = await runConvertUnit(synthetic, GLUCOSE, ports);
    expect(result).toEqual({
      analyte: "glucose",
      from_value: 126,
      from_unit: "mg/dL",
      value: 7,
      unrounded: 6.9937833037300186,
      unit: "mmol/L",
      formula: "mmol/L = mg/dL ÷ 18.016",
      rounding: "half away from zero to 1 decimal",
    });
    expect(reads).toEqual([]);
    expect(audits).toEqual([
      {
        actor: "local",
        sessionId: "turn",
        subjectRef: null,
        tool: "convert_unit",
        args: GLUCOSE,
        result,
        rowCount: 0,
      },
    ]);
  });

  test("converts in personal mode too: it reads nothing to scope", async () => {
    const { ports, audits } = fakePorts();
    const input = { value: 48, from: "mmol/mol", to: "%", analyte: "hba1c" } as const;
    const result = await runConvertUnit(personal, input, ports);
    expect(result).toEqual({
      analyte: "hba1c",
      from_value: 48,
      from_unit: "mmol/mol",
      value: 6.5,
      unrounded: 6.541984628053802,
      unit: "%",
      formula: "% = mmol/mol ÷ 10.929 + 2.15",
      rounding: "half away from zero to 1 decimal",
    });
    expect(audits.map((audit) => [audit.tool, audit.rowCount])).toEqual([
      ["convert_unit", 0],
    ]);
  });

  test("HbA1c % to mmol/L is refused with the pairs the table holds", async () => {
    const { ports, audits } = fakePorts();
    const input = { value: 6.5, from: "%", to: "mmol/L", analyte: "hba1c" } as const;
    const result = await runConvertUnit(synthetic, input, ports);
    expect(result).toEqual({
      code: "UNSUPPORTED_CONVERSION",
      error: "the conversion table has no factor for this analyte between these units",
      analyte: "hba1c",
      from: "%",
      to: "mmol/L",
      supported: ["% → mmol/mol", "mmol/mol → %"],
    });
    expect(result).toEqual(
      unsupportedConversion("hba1c", "%", "mmol/L", ["% → mmol/mol", "mmol/mol → %"]),
    );
    expect(audits.map((audit) => [audit.result, audit.rowCount])).toEqual([[result, 0]]);
  });

  test("a temperature in mg/dL is refused, not guessed", async () => {
    const { ports } = fakePorts();
    const input = {
      value: 37,
      from: "mg/dL",
      to: "Cel",
      analyte: "body_temperature",
    } as const;
    expect(await runConvertUnit(synthetic, input, ports)).toEqual({
      code: "UNSUPPORTED_CONVERSION",
      error: "the conversion table has no factor for this analyte between these units",
      analyte: "body_temperature",
      from: "mg/dL",
      to: "Cel",
      supported: ["Cel → [degF]", "[degF] → Cel"],
    });
  });

  test("the same unit on both sides is refused with its own reason", async () => {
    const { ports } = fakePorts();
    const input = { value: 126, from: "mg/dL", to: "mg/dL", analyte: "glucose" } as const;
    expect(await runConvertUnit(synthetic, input, ports)).toEqual({
      code: "UNSUPPORTED_CONVERSION",
      error: "from and to are the same unit; there is nothing to convert",
      analyte: "glucose",
      from: "mg/dL",
      to: "mg/dL",
      supported: ["mg/dL → mmol/L", "mmol/L → mg/dL"],
    });
  });

  test("an audit write that throws reaches the caller", async () => {
    const { ports: base } = fakePorts();
    const ports: QueryToolPorts = {
      ...base,
      appendAudit: () => Promise.reject(new Error("synthetic audit down")),
    };
    await expect(runConvertUnit(synthetic, GLUCOSE, ports)).rejects.toThrow(
      "synthetic audit down",
    );
  });
});

import { describe, expect, test } from "bun:test";

import {
  MAX_ROWS_PER_CALL,
  numberSources,
  type NumberSourcePart,
  unsourcedNumbers,
} from "./number-sources";

/** Synthetic tool parts, shaped like the query tools' outputs. */
const LATEST: NumberSourcePart = {
  toolCallId: "1",
  input: { loinc: ["4548-4"] },
  output: {
    codes: [
      {
        loinc: "4548-4",
        display: "Hemoglobin A1c",
        unit_ucum: "%",
        value: 5.94,
        effective: "2024-03-01",
      },
    ],
  },
};

const WEIGHTS: NumberSourcePart = {
  toolCallId: "2",
  input: { loinc: "29463-7" },
  output: {
    rows: [
      { loinc: "29463-7", value: 80, unit_ucum: "kg", effective: "2023-01-05" },
      { loinc: "29463-7", value: 81.2, unit_ucum: "kg", effective: "2023-06-01" },
    ],
  },
};

const STATS: NumberSourcePart = {
  toolCallId: "3",
  input: { loinc: "4548-4" },
  output: { n: 14, mean: 6.21, min: 5.9, max: 6.5, unit_ucum: "%" },
};

const TEXT = [
  "HbA1c ranged from 5.9 % to 6.5 % over 14 readings, mean 6.2 %.",
  "The latest was 5.94 % on 2024-03-01.",
  "Weight 80 kg (176 lb) on 3 Mar 2023, 7 days apart; 123.4 is made up.",
].join(" ");

/** Where `number` starts in TEXT, found by `before` (the number and what follows). */
const at = (number: string, before: string = number) => {
  const start = TEXT.indexOf(before);
  return { start, end: start + number.length };
};

describe("numberSources", () => {
  test("maps each number to the calls and rows that hold it, exactly", () => {
    expect(numberSources(TEXT, [LATEST, WEIGHTS, STATS])).toEqual([
      // A range: both ends are sourced on their own. 5.94 rounds to 5.9.
      {
        text: "5.9",
        ...at("5.9", "5.9 %"),
        toolCallId: "1",
        rowIndex: 0,
        field: "value",
      },
      { text: "5.9", ...at("5.9", "5.9 %"), toolCallId: "3", field: "min" },
      { text: "6.5", ...at("6.5"), toolCallId: "3", field: "max" },
      { text: "14", ...at("14"), toolCallId: "3", field: "n" },
      { text: "6.2", ...at("6.2"), toolCallId: "3", field: "mean" },
      { text: "5.94", ...at("5.94"), toolCallId: "1", rowIndex: 0, field: "value" },
      // Within 1 % of the minimum, the scorer's tolerance; the date of row 1 is no source.
      { text: "5.94", ...at("5.94"), toolCallId: "3", field: "min" },
      { text: "80", ...at("80", "80 kg"), toolCallId: "2", rowIndex: 0, field: "value" },
      // 80 kg narrated in pounds: the kg row is the source.
      { text: "176", ...at("176"), toolCallId: "2", rowIndex: 0, field: "value" },
    ]);
  });

  test("leaves dates, 0 to 10 and numbers no call holds unlinked", () => {
    const linked = new Set(
      numberSources(TEXT, [LATEST, WEIGHTS, STATS]).map((s) => s.text),
    );
    expect(["2024", "2023", "3", "7", "123.4"].filter((t) => linked.has(t))).toEqual([]);
    expect(
      unsourcedNumbers(TEXT, [LATEST, WEIGHTS, STATS]).map((n) => [n.text, n.start]),
    ).toEqual([["123.4", TEXT.indexOf("123.4")]]);
  });

  test("a number the question gave is not counted as unsourced", () => {
    expect(unsourcedNumbers("You asked about 123.4 mg.", [], [123.4])).toEqual([]);
  });

  test("lists at most MAX_ROWS_PER_CALL rows of one call for one number", () => {
    const many: NumberSourcePart = {
      toolCallId: "7",
      output: { rows: Array.from({ length: 9 }, () => ({ value: 62 })) },
    };
    expect(
      numberSources("Resting heart rate 62 bpm.", [many]).map((s) => s.rowIndex),
    ).toEqual([0, 1, 2, 3, 4].slice(0, MAX_ROWS_PER_CALL));
  });

  test("a chart's points are its rows; a running call holds nothing", () => {
    const chart: NumberSourcePart = {
      toolCallId: "c1",
      output: { spec: { points: [{ t: "2026-01-01", value: 48.5 }] } },
    };
    const running: NumberSourcePart = { toolCallId: "r1", input: { loinc: "8867-4" } };
    expect(numberSources("HRV 48.5 ms.", [running, chart])).toEqual([
      { text: "48.5", start: 4, end: 8, toolCallId: "c1", rowIndex: 0, field: "value" },
    ]);
  });
});

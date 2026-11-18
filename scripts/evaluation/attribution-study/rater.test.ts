import { describe, expect, test } from "bun:test";

import { DEV_OPTIONS, generateW1 } from "../../synthetic-wearables/w1-items";
import { parseCsv } from "../rater-sheet";

import { studyItems } from "./counterfactual";
import {
  raterAgreement,
  raterSample,
  raterSheet,
  readFilledSheet,
  SHEET_COLUMNS,
} from "./rater";
import { fakeModel, runStudy, studyCells } from "./run";

const items = generateW1(DEV_OPTIONS);
const byId = new Map(items.map((item) => [item.id, item]));
const records = await runStudy({
  cells: studyCells(studyItems(items, true)),
  models: [fakeModel("first_listed"), fakeModel("cite_other")],
  repeats: 1,
});
const SALT = "0123456789abcdef0123456789abcdef";

describe("raterSample", () => {
  test("base answers only, every stratum present, seeded", () => {
    const sample = raterSample(records, 40, 7);
    expect(sample.length).toBeLessThanOrEqual(40);
    expect(sample.every((record) => record.variant === "base")).toBe(true);
    expect(new Set(sample.map((record) => record.stratum)).size).toBe(6);
    expect(raterSample(records, 40, 7)).toEqual(sample);
  });
});

describe("raterSheet", () => {
  const sample = raterSample(records, 30, 7);
  const sheet = raterSheet(sample, byId, SALT);
  const [header, ...rows] = parseCsv(sheet.csv);

  test("one row per sampled answer, under the study header", () => {
    expect(header).toEqual([...SHEET_COLUMNS]);
    expect(rows.filter((row) => row.length > 1)).toHaveLength(sample.length);
  });

  test("blind: no model, condition, item id or expected answer", () => {
    for (const forbidden of [
      "fake:",
      "first_listed",
      "cite_other",
      ",C0,",
      ",C1,",
      ",C2,",
      "test-6509-w1-",
      "expected",
    ]) {
      expect(sheet.csv).not.toContain(forbidden);
    }
  });

  test("every row shows the rule and the readings with source and day", () => {
    for (const row of rows.filter((cells) => cells.length > 1)) {
      expect(row[3]).toStartWith("Selection rule:");
      expect(row[2]).toMatch(/(Oura|WHOOP|Google Health), \d{1,2} \w{3} \d{4}: /);
    }
  });

  test("the key maps each sheet id back to its answer", () => {
    expect(sheet.key.entries).toHaveLength(sample.length);
    expect(new Set(sheet.key.entries.map((entry) => entry.sheetId)).size).toBe(
      sample.length,
    );
  });
});

describe("readFilledSheet and raterAgreement", () => {
  const sample = raterSample(records, 60, 3);
  const sheet = raterSheet(sample, byId, SALT);

  /** A rater who agrees with the scorer on every outcome the row has. */
  const filledLike = (flip: boolean) => {
    const [header, ...rows] = parseCsv(sheet.csv);
    const lines = rows
      .filter((row) => row.length > 1)
      .map((row, index) => {
        const record = sample[index]!;
        const out = [...row];
        const set = (column: string, value: boolean | null | undefined) => {
          if (typeof value !== "boolean") return;
          out[SHEET_COLUMNS.indexOf(column as (typeof SHEET_COLUMNS)[number])] = (
            flip ? !value : value
          )
            ? "y"
            : "n";
        };
        set("attribution_correct", record.score?.attributionCorrect);
        set("disagreement_handled", record.score?.disagreementHandled);
        return out;
      });
    return [header!, ...lines]
      .map((row) => row.map((cell) => JSON.stringify(cell)).join(","))
      .join("\n");
  };

  test("a rater who agrees everywhere has kappa 1 where both codes occur", () => {
    const agreement = raterAgreement(
      readFilledSheet(filledLike(false)),
      sheet.key,
      records,
    );
    const attribution = agreement.find((row) => row.column === "attribution_correct");
    expect(attribution?.n).toBe(sample.length);
    expect(attribution?.kappa?.kappa).toBe(1);
  });

  test("a rater who disagrees everywhere agrees on nothing, kappa below zero", () => {
    const agreement = raterAgreement(
      readFilledSheet(filledLike(true)),
      sheet.key,
      records,
    );
    const kappa = agreement.find((row) => row.column === "attribution_correct")?.kappa;
    expect(kappa?.observed).toBe(0);
    expect(kappa?.kappa).toBeLessThan(0);
  });

  test("blank codes are not rated", () => {
    const blank = raterAgreement(readFilledSheet(sheet.csv), sheet.key, records);
    expect(blank.every((row) => row.n === 0)).toBe(true);
  });

  test("a code that is not y or n, or another header, is a problem", () => {
    const [header, first] = parseCsv(sheet.csv);
    const row = [...first!];
    row[SHEET_COLUMNS.indexOf("attribution_correct")] = "maybe";
    const text = [header!, row]
      .map((cells) => cells.map((c) => JSON.stringify(c)).join(","))
      .join("\n");
    expect(readFilledSheet(text).problems).toHaveLength(1);
    expect(readFilledSheet("a,b\n").problems).toHaveLength(1);
  });
});

import { describe, expect, test } from "bun:test";

import {
  cellOf,
  cellsOf,
  citationVerdict,
  confusableCells,
  measureOfKey,
  traceStated,
  type WearableCell,
} from "./wearable-cell";

const ouraHrv = {
  key: "sleep.hrv.long_sleep.2026-01-02",
  label: "Average HRV during sleep (2026-01-02)",
  value: 45.3,
  unit: "ms",
};
const whoopHrv = {
  key: "whoop.recovery.hrv.2026-01-02",
  label: "Whoop HRV (2026-01-02)",
  value: 52.1,
  unit: "ms",
};
const whoopHrvDayBefore = {
  key: "whoop.recovery.hrv.2026-01-01",
  label: "Whoop HRV (2026-01-01)",
  value: 48,
  unit: "ms",
};
const googleRhr = {
  key: "google.daily-resting-heart-rate.2026-01-02",
  label: "Resting heart rate (2026-01-02)",
  value: 58,
  unit: "bpm",
};
const ouraSteps = {
  key: "activity.steps.2026-01-02",
  label: "Steps (2026-01-02)",
  value: 8432,
};

const cells = (): readonly WearableCell[] =>
  cellsOf([ouraHrv, whoopHrv, whoopHrvDayBefore, googleRhr, ouraSteps]);

const only = (key: string): WearableCell => {
  const cell = cells().find((candidate) => candidate.key === key);
  if (cell === undefined) throw new Error(`no cell ${key}`);
  return cell;
};

describe("cellOf", () => {
  test("source from the key's prefix, day from the key, compared measure", () => {
    expect(cellOf(whoopHrv)).toEqual({
      key: "whoop.recovery.hrv.2026-01-02",
      source: "whoop",
      measure: "heart-rate-variability",
      day: "2026-01-02",
      value: 52.1,
      unit: "ms",
      label: "Whoop HRV (2026-01-02)",
    });
    expect(cellOf(ouraHrv)?.source).toBe("oura");
    expect(cellOf(ouraHrv)?.measure).toBe("heart-rate-variability");
  });

  test("an offered metric's own source and date win", () => {
    expect(
      cellOf({
        ...ouraSteps,
        key: "activity.steps",
        date: "2026-01-03",
        source: "google_health",
      }),
    ).toMatchObject({ source: "google_health", day: "2026-01-03" });
  });

  test("a numeric string is a number; any other value is no cell", () => {
    expect(cellOf({ ...ouraSteps, value: "8432" })?.value).toBe(8432);
    expect(cellOf({ ...ouraSteps, value: "good" })).toBeNull();
    expect(cellsOf([{ ...ouraSteps, value: "n/a" }, googleRhr])).toHaveLength(1);
  });

  test("a key the rules do not compare is its own measure", () => {
    expect(measureOfKey("sleep.score.2026-01-02")).toBe("sleep.score");
    expect(measureOfKey("whoop.recovery.hrv.unknown")).toBe("heart-rate-variability");
  });
});

describe("traceStated", () => {
  test("a number finds the one cell whose value it is", () => {
    expect(traceStated("52 ms", "heart-rate-variability", cells())).toEqual({
      kind: "one",
      cell: only("whoop.recovery.hrv.2026-01-02"),
    });
  });

  test("only cells of the measure asked for", () => {
    expect(traceStated("58", "heart-rate-variability", cells())).toEqual({
      kind: "none",
    });
    expect(traceStated("58 bpm", "resting-heart-rate", cells()).kind).toBe("one");
  });

  test("a number two cells round to is ambiguous", () => {
    const close = cellsOf([ouraHrv, { ...whoopHrv, value: 44.8 }]);
    const trace = traceStated("45 ms", "heart-rate-variability", close);
    expect(trace.kind).toBe("several");
  });
});

describe("citationVerdict", () => {
  const cited = only("sleep.hrv.long_sleep.2026-01-02");
  const verdict = (stated: string) =>
    citationVerdict(cited, traceStated(stated, cited.measure, cells()));

  test("the number is the cited cell's value", () => {
    expect(verdict("45 ms")).toBe("correct");
  });

  test("the number is another source's value that day", () => {
    expect(verdict("52 ms")).toBe("wrong_source");
  });

  test("the number is another source's value on another day", () => {
    expect(verdict("48 ms")).toBe("wrong_source_and_day");
  });

  test("the same source on another day", () => {
    const whoop = only("whoop.recovery.hrv.2026-01-02");
    expect(citationVerdict(whoop, traceStated("48 ms", whoop.measure, cells()))).toBe(
      "wrong_day",
    );
  });

  test("a number no cell holds, and one two cells hold", () => {
    expect(verdict("61 ms")).toBe("untraced");
    expect(
      citationVerdict(cited, {
        kind: "several",
        cells: [cited, only("whoop.recovery.hrv.2026-01-02")],
      }),
    ).toBe("ambiguous");
  });

  test("a cell of another measure", () => {
    expect(
      citationVerdict(cited, { kind: "one", cell: only("activity.steps.2026-01-02") }),
    ).toBe("wrong_measure");
  });
});

describe("confusableCells", () => {
  test("cells a display unit apart are identifiable", () => {
    expect(confusableCells(cells())).toEqual([]);
  });

  test("two readings the app shows as one number are a pair", () => {
    const close = cellsOf([ouraHrv, { ...whoopHrv, value: 44.8 }, googleRhr]);
    expect(confusableCells(close).map(([a, b]) => [a.key, b.key])).toEqual([
      ["sleep.hrv.long_sleep.2026-01-02", "whoop.recovery.hrv.2026-01-02"],
    ]);
  });

  test("the same number on two measures is not a pair", () => {
    const sameNumber = cellsOf([{ ...ouraHrv, value: 58 }, googleRhr]);
    expect(confusableCells(sameNumber)).toEqual([]);
  });

  test("steps a few apart are told apart, the same count is not", () => {
    expect(
      confusableCells(
        cellsOf([
          ouraSteps,
          { ...ouraSteps, key: "google.steps.2026-01-02", value: 8433 },
        ]),
      ),
    ).toEqual([]);
    expect(
      confusableCells(
        cellsOf([ouraSteps, { ...ouraSteps, key: "google.steps.2026-01-02" }]),
      ),
    ).toHaveLength(1);
  });
});

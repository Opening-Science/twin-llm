import { describe, expect, test } from "bun:test";

import EXAMPLE from "@/docs/kiosk-day.example.json";
import { kioskDaySchema } from "@/packages/query-tools/kiosk-day";

import { type KioskBeat } from "./beat-focus";
import { beatRows } from "./beat-runs";

const BASE = kioskDaySchema
  .parse(EXAMPLE)
  .beats.find((beat) => beat.source === "measured")!;

const NAME = { heart_rate: "Heart rate", glucose: "Blood glucose" } as const;

const reading = (
  time: string,
  measure: "heart_rate" | "glucose",
  value: number,
  direction: KioskBeat["direction"] = "steady",
  name: string = NAME[measure],
): KioskBeat => {
  const unit = measure === "heart_rate" ? "/min" : "mg/dL";
  return {
    ...BASE,
    time,
    event: "Reading",
    source: "measured",
    measure,
    direction,
    value,
    unit,
    line: `${name} ${direction} · about ${Math.round(value)} ${unit} · measured`,
    worth_a_look: false,
  };
};

describe("beatRows", () => {
  test("folds three or more steady readings in a row, one line per signal", () => {
    const beats = [
      reading("06:00", "heart_rate", 77),
      reading("06:30", "glucose", 84),
      reading("07:00", "heart_rate", 74.4),
      reading("08:00", "heart_rate", 92, "up"),
    ];
    expect(beatRows(beats)).toEqual([
      {
        kind: "run",
        first: 0,
        last: 2,
        lines: [
          {
            name: "Heart rate",
            from: "06:00",
            to: "07:00",
            low: 74,
            high: 77,
            unit: "/min",
          },
          {
            name: "Blood glucose",
            from: "06:30",
            to: "06:30",
            low: 84,
            high: 84,
            unit: "mg/dL",
          },
        ],
      },
      { kind: "beat", index: 3 },
    ]);
  });

  test("blood and sensor glucose keep their own lines", () => {
    const beats = [
      reading("06:00", "glucose", 84),
      reading("06:15", "glucose", 95, "steady", "Sensor glucose"),
      reading("06:30", "glucose", 88),
    ];
    const [row] = beatRows(beats);
    expect(
      row?.kind === "run"
        ? row.lines.map((line) => [line.name, line.low, line.high])
        : null,
    ).toEqual([
      ["Blood glucose", 84, 88],
      ["Sensor glucose", 95, 95],
    ]);
  });

  test("two steady readings stay as beats", () => {
    const beats = [
      reading("06:00", "heart_rate", 77),
      reading("07:00", "heart_rate", 74),
    ];
    expect(beatRows(beats)).toEqual([
      { kind: "beat", index: 0 },
      { kind: "beat", index: 1 },
    ]);
  });

  test("a change, a window or another event breaks the run", () => {
    const worth = {
      ...reading("07:30", "glucose", 150),
      source: "derived" as const,
      worth_a_look: true,
    };
    const named = { ...reading("09:00", "heart_rate", 70), event: "Walk" };
    const beats = [
      reading("06:00", "heart_rate", 77),
      reading("07:00", "heart_rate", 74),
      worth,
      reading("08:00", "heart_rate", 75),
      named,
      reading("10:00", "heart_rate", 72),
    ];
    expect(beatRows(beats).every((row) => row.kind === "beat")).toBe(true);
  });

  test("every beat is in exactly one row", () => {
    const beats = Array.from({ length: 9 }, (_, i) =>
      reading(
        `${String(6 + i).padStart(2, "0")}:00`,
        i % 3 === 0 ? "glucose" : "heart_rate",
        70 + i,
        i === 4 ? "up" : "steady",
      ),
    );
    const covered = beatRows(beats).flatMap((row) =>
      row.kind === "beat"
        ? [row.index]
        : Array.from({ length: row.last - row.first + 1 }, (_, i) => row.first + i),
    );
    expect(covered).toEqual(beats.map((_, index) => index));
  });
});

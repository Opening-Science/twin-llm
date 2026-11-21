import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { kioskDaySchema } from "./kiosk-day";
import { MOCK_DAY_REF, mockKioskDay } from "./mock-kiosk-day";

const EXAMPLE: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../docs/kiosk-day.example.json", import.meta.url)),
    "utf8",
  ),
);

describe("mockKioskDay", () => {
  test("without diabetes is the committed example, beat for beat", () => {
    expect(mockKioskDay("without_diabetes")).toEqual(kioskDaySchema.parse(EXAMPLE));
  });

  test("carries the mock's own ref, never a warehouse subject", () => {
    expect(mockKioskDay("with_diabetes").subject_ref).toBe(MOCK_DAY_REF);
    expect(MOCK_DAY_REF).toBe("synthetic-mock-day");
  });

  test("never calls a made-up value measured", () => {
    const lines = (["blood", "sensor", "both"] as const).flatMap((glucose) =>
      mockKioskDay("without_diabetes", glucose).beats.map((beat) => beat.line),
    );
    expect(lines.filter((line) => line.endsWith("· measured"))).toEqual([]);
    expect(lines).toContain(
      "Heart rate steady · about 52 /min · illustrative, not measured",
    );
  });

  test("reads blood glucose only unless asked for the sensor too", () => {
    const sensorLines = (glucose?: "both") =>
      mockKioskDay("without_diabetes", glucose)
        .beats.filter((beat) => beat.line.startsWith("Sensor glucose"))
        .map((beat) => beat.time);
    expect(sensorLines()).toEqual([]);
    expect(sensorLines("both")).toHaveLength(1);
  });

  test("with diabetes reads the same day against the other thresholds", () => {
    const without = mockKioskDay("without_diabetes");
    const withDiabetes = mockKioskDay("with_diabetes");
    expect([withDiabetes.profile, withDiabetes.day]).toEqual([
      "with_diabetes",
      without.day,
    ]);
    expect(withDiabetes.worth_a_look.map((window) => window.rule)).not.toEqual(
      without.worth_a_look.map((window) => window.rule),
    );
  });
});

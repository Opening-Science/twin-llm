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

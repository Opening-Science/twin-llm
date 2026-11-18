import { describe, expect, test } from "bun:test";

import { spokenUnits } from "./spoken-units";

describe("spokenUnits", () => {
  test("English units after a number become words", () => {
    expect(
      spokenUnits(
        "Resting heart rate 58 bpm, glucose 5.4 mmol/L (97 mg/dL), weight 72.5 kg, sleep 7 h, HRV 42 ms, 12% body fat, 37.1°C.",
        "en",
      ),
    ).toBe(
      "Resting heart rate 58 beats per minute, glucose 5.4 millimoles per litre (97 milligrams per decilitre), weight 72.5 kilograms, sleep 7 hours, HRV 42 milliseconds, 12 per cent body fat, 37.1 degrees Celsius.",
    );
  });

  test("German units, a decimal comma, ranges and a blood pressure", () => {
    expect(
      spokenUnits(
        "Ruhepuls 58–64 bpm, Blutzucker 5.4 mmol/L, Blutdruck 118/76 mmHg.",
        "de",
      ),
    ).toBe(
      "Ruhepuls 58 bis 64 Schläge pro Minute, Blutzucker 5,4 Millimol pro Liter, Blutdruck 118 zu 76 Millimeter Quecksilbersäule.",
    );
  });

  test("an English blood pressure and range", () => {
    expect(spokenUnits("118/76 mmHg, between 58-64 bpm", "en")).toBe(
      "118 over 76 millimetres of mercury, between 58 to 64 beats per minute",
    );
  });

  test("words that only look like units stay", () => {
    expect(spokenUnits("He has 2 hearts and 3 hmm, ms Smith, 5 kgs", "en")).toBe(
      "He has 2 hearts and 3 hmm, ms Smith, 5 kgs",
    );
  });

  test("a date or fraction that is not a pressure stays", () => {
    expect(spokenUnits("On 3/4 of days", "en")).toBe("On 3/4 of days");
    expect(spokenUnits("On 2026-11-18 it was 60-62 bpm", "en")).toBe(
      "On 2026-11-18 it was 60 to 62 beats per minute",
    );
  });

  test("a German date or clock time keeps its dots; only a decimal gets the comma", () => {
    expect(
      spokenUnits("Am 18.11.2026 um 7.30 Uhr lag der Blutzucker bei 5.4 mmol/L.", "de"),
    ).toBe("Am 18.11.2026 um 7.30 Uhr lag der Blutzucker bei 5,4 Millimol pro Liter.");
    expect(spokenUnits("Von 7.30–8.15 Uhr, ab 22.45 ruhig.", "de")).toBe(
      "Von 7.30 bis 8.15 Uhr, ab 22.45 ruhig.",
    );
  });

  test("exactly 1 takes the singular", () => {
    expect(spokenUnits("1 h, 1 min, 1 kcal, 1 bpm and 1.5 h, 21 h", "en")).toBe(
      "1 hour, 1 minute, 1 kilocalorie, 1 beat per minute and 1.5 hours, 21 hours",
    );
    expect(spokenUnits("1 h und 1 min, 1 kg, 11 h", "de")).toBe(
      "1 Stunde und 1 Minute, 1 Kilogramm, 11 Stunden",
    );
  });
});

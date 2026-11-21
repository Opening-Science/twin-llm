import { describe, expect, test } from "bun:test";

import { organNamed } from "./organ-named";

describe("organNamed", () => {
  test("the organ an English answer names first", () => {
    expect(
      organNamed("Your heart rate was steady; your blood pressure was 118/76.", ""),
    ).toBe("heart");
    expect(organNamed("Blood pressure first, then the heart.", "")).toBe(
      "bloodvasculature",
    );
    expect(organNamed("Your kidneys filter well (eGFR 92).", "")).toBe("kidney");
  });

  test("German words and compounds", () => {
    expect(organNamed("Deine Herzfrequenz lag in Ruhe bei 58.", "")).toBe("heart");
    expect(organNamed("Die Nierenwerte sind unauffällig.", "")).toBe("kidney");
    expect(organNamed("Dein Blutzucker stieg nach dem Frühstück.", "")).toBe("pancreas");
    expect(organNamed("Die Leberwerte (ALT) liegen im Bereich.", "")).toBe("liver");
    expect(organNamed("Die Blutgefäße sind elastisch.", "")).toBe("bloodvasculature");
  });

  test("a word that only contains an organ's letters is not it", () => {
    expect(organNamed("Herzlich willkommen. Schmerz im Knie.", "")).toBeNull();
    expect(organNamed("A heartfelt thanks.", "")).toBeNull();
  });

  test("the question when the answer names none", () => {
    expect(organNamed("Here it is.", "Show me my heart.")).toBe("heart");
    expect(organNamed("Bitte schön.", "Zeig mir meine Lunge.")).toBe("lung");
  });

  test("nothing named, no turn", () => {
    expect(organNamed("Your sleep was 7 hours.", "How did I sleep?")).toBeNull();
  });
});

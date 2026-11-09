import { describe, expect, test } from "bun:test";

import {
  ACCURACY_NOTES,
  ACCURACY_ROWS,
  ACCURACY_SOURCES,
  VERIFIED_ON,
} from "./accuracy-notes";

const sourceIds = Object.keys(ACCURACY_SOURCES) as (keyof typeof ACCURACY_SOURCES)[];
const rowNumbers = Object.keys(ACCURACY_ROWS).map(Number);

/** "Dial 2025" for a source whose authors start "Dial MB, …". */
const shortName = (id: keyof typeof ACCURACY_SOURCES): string => {
  const source = ACCURACY_SOURCES[id];
  return `${source.authors.split(" ")[0]!.replace(/,$/, "")} ${source.year}`;
};

describe("accuracy notes data", () => {
  test("one note per device and measure: 4 devices by 9 measures", () => {
    const keys = ACCURACY_NOTES.map((n) => `${n.device} ${n.measure}`);
    expect(keys.length).toBe(36);
    expect(new Set(keys).size).toBe(36);
    expect([...new Set(ACCURACY_NOTES.map((n) => n.device))]).toEqual([
      "oura",
      "whoop",
      "fitbit",
      "pixel-watch",
    ]);
  });

  test("was verified on 9 Nov 2026", () => {
    expect(VERIFIED_ON).toBe("2026-11-09");
  });

  test("every cited row is in the file, and every row and paper is cited", () => {
    const cited = [...new Set(ACCURACY_NOTES.flatMap((n) => n.rows))].sort(
      (a, b) => a - b,
    );
    expect(cited).toEqual(rowNumbers.sort((a, b) => a - b));
    const usedSources = [...new Set(rowNumbers.map((r) => ACCURACY_ROWS[r]!.source))];
    expect(usedSources.sort()).toEqual([...sourceIds].sort());
  });

  test("a note with a number cites at least one verified row", () => {
    const uncited = ACCURACY_NOTES.filter(
      (n) => /\d/.test(n.note.replace(/\b(19|20)\d\d\b/g, "")) && n.rows.length === 0,
    ).map((n) => `${n.device} ${n.measure}`);
    expect(uncited).toEqual([]);
  });

  test("every study a note or its funding line names is one it cites", () => {
    const strays = ACCURACY_NOTES.flatMap((n) => {
      const cited = new Set(n.rows.map((r) => shortName(ACCURACY_ROWS[r]!.source)));
      const named = `${n.note} ${n.funding ?? ""}`.match(
        /\b[A-Z][A-Za-z-]+ (19|20)\d\d\b/g,
      );
      return (named ?? [])
        .filter((name) => !cited.has(name))
        .map((name) => `${n.device} ${n.measure}: ${name}`);
    });
    expect(strays).toEqual([]);
  });

  test("a note without validation says so and cites at most a review of the scores", () => {
    const none = ACCURACY_NOTES.filter((n) => n.evidence === "none");
    expect(none.map((n) => `${n.device} ${n.measure} ${n.rows.length}`)).toEqual([
      "oura spo2 0",
      "oura compositeScores 0",
      "whoop energyExpenditure 0",
      "whoop spo2 0",
      "whoop compositeScores 1",
      "fitbit hrv 0",
      "fitbit compositeScores 0",
      "pixel-watch restingHeartRate 0",
      "pixel-watch hrv 0",
      "pixel-watch sleepWake 0",
      "pixel-watch spo2 0",
      "pixel-watch compositeScores 0",
    ]);
    expect(
      ACCURACY_NOTES.filter((n) => n.measure === "compositeScores").map((n) =>
        /no published (study|validation)/i.test(n.note),
      ),
    ).toEqual([true, true, true, true]);
  });

  test("every paper has a DOI or a link, and a funding statement", () => {
    const incomplete = sourceIds.filter((id) => {
      const s = ACCURACY_SOURCES[id];
      return !(s.doi?.startsWith("10.") ?? s.url.startsWith("https://")) || !s.funding;
    });
    expect(incomplete).toEqual([]);
  });
});

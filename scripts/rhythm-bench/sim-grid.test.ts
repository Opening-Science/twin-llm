import { describe, expect, test } from "bun:test";

import { subjectRhythmSettings } from "@/packages/query-tools/rhythm-recording";
import { simulateRecording } from "@/packages/rhythm-sim/simulate-recording";

import {
  cellId,
  FULL_GRID,
  gridCells,
  NOISE_LEVELS,
  RHYTHM_CONDITIONS,
  recordingConfigForCell,
  recordingSeed,
} from "./sim-grid";

const condition = (id: string) => {
  const found = RHYTHM_CONDITIONS.find((each) => each.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};

describe("gridCells", () => {
  test("sinus has no AF rate; AF conditions take every rate", () => {
    // 4 lengths × (3 sinus + 4 AF conditions × 3 rates) × 3 noise levels.
    const cells = gridCells(FULL_GRID);
    expect(cells.length).toBe(4 * 15 * 3);
    expect(
      cells
        .filter((cell) => cell.rhythm.kind === "sinus")
        .every((cell) => cell.afRate === null),
    ).toBe(true);
    expect(cellId(cells[0])).toBe("30s|sinus|-|none");
  });
});

describe("recordingConfigForCell", () => {
  const base = { durationSec: 300, afRate: 130, noise: NOISE_LEVELS[0] };

  test("sinus with ectopy: counts per minute of recording, profile from the tool", () => {
    const config = recordingConfigForCell(
      { ...base, rhythm: condition("sinus+ectopy-6/3"), afRate: null },
      4,
    );
    const profile = subjectRhythmSettings("rhythm-bench-profile-4");
    expect(config).toMatchObject({
      rhythm: "sinus",
      durationSec: 300,
      pacCount: 30,
      pvcCount: 15,
      meanHr: profile.meanHr,
      afMeanHr: profile.afMeanHr,
    });
  });

  test("AF dependence: independent unless asked, the same seed and episode either way", () => {
    const cell = { ...base, rhythm: condition("paroxysmal-30%") };
    const independent = recordingConfigForCell(cell, 2);
    const shortRange = recordingConfigForCell(cell, 2, "short_range");
    expect(independent.afDependence).toBe("independent");
    expect(shortRange).toEqual({ ...independent, afDependence: "short_range" });
  });

  test("paroxysmal: one episode of the burden inside the recording", () => {
    const config = recordingConfigForCell(
      { ...base, rhythm: condition("paroxysmal-30%") },
      2,
    );
    const episode = config.afEpisodes?.[0];
    expect(config.rhythm).toBe("paroxysmal_af");
    expect(config.afMeanHr).toBe(130);
    expect(
      episode === undefined
        ? null
        : Math.round((episode.endSec - episode.startSec) * 10) / 10,
    ).toBe(90);
    expect((episode?.startSec ?? -1) >= 0 && (episode?.endSec ?? 301) <= 300).toBe(true);
  });

  test("every cell of the full grid makes a recording for several seeds", () => {
    const cells = gridCells({ ...FULL_GRID, noise: [NOISE_LEVELS[0]] });
    const lengths = [0, 1, 2].flatMap((seed) =>
      cells.map(
        (cell) => simulateRecording(recordingConfigForCell(cell, seed)).rrMs.length,
      ),
    );
    expect(lengths.every((n) => n > 10)).toBe(true);
  });

  test("the noise level does not change the recording seed", () => {
    const cell = { ...base, rhythm: condition("persistent") };
    expect(recordingSeed({ ...cell, noise: NOISE_LEVELS[2] }, 1)).toBe(
      recordingSeed(cell, 1),
    );
    expect(recordingSeed(cell, 2)).not.toBe(recordingSeed(cell, 1));
  });
});

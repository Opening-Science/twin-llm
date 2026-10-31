import { describe, expect, test } from "bun:test";

import { afEpisodesOf, parseRecordingConfig } from "./recording-config";

describe("parseRecordingConfig", () => {
  test("fills the documented defaults", () => {
    expect(parseRecordingConfig({ seed: 1, durationSec: 60, rhythm: "sinus" })).toEqual({
      seed: 1,
      durationSec: 60,
      rhythm: "sinus",
      meanHr: 65,
      rrSdMs: 40,
      respRateHz: 0.25,
      lfHz: 0.1,
      lfHfRatio: 0.5,
      peakWidthHz: 0.01,
      noiseSdMs: 5,
      afMeanHr: 100,
      afCv: 0.2,
      afDependence: "independent",
      pacCount: 0,
      pvcCount: 0,
      pacPrematurity: 0.25,
      pvcPrematurity: 0.25,
      pulseNoise: 0.02,
      motionArtefact: false,
    });
  });

  test("afDependence takes independent or short_range only", () => {
    const base = { seed: 1, durationSec: 60, rhythm: "af" } as const;
    expect(
      parseRecordingConfig({ ...base, afDependence: "short_range" }).afDependence,
    ).toBe("short_range");
    expect(() =>
      parseRecordingConfig({ ...base, afDependence: "markov" as "short_range" }),
    ).toThrow();
  });

  test("a respiratory rate outside 0.15–0.4 Hz is refused", () => {
    expect(() =>
      parseRecordingConfig({
        seed: 1,
        durationSec: 60,
        rhythm: "sinus",
        respRateHz: 0.5,
      }),
    ).toThrow();
  });
});

describe("afEpisodesOf", () => {
  const base = { seed: 1, durationSec: 90 } as const;

  test("sinus: none; AF: the whole recording; paroxysmal: the middle third", () => {
    expect(afEpisodesOf(parseRecordingConfig({ ...base, rhythm: "sinus" }))).toEqual([]);
    expect(afEpisodesOf(parseRecordingConfig({ ...base, rhythm: "af" }))).toEqual([
      { startSec: 0, endSec: 90 },
    ]);
    expect(
      afEpisodesOf(parseRecordingConfig({ ...base, rhythm: "paroxysmal_af" })),
    ).toEqual([{ startSec: 30, endSec: 60 }]);
  });

  test("given episodes come back in time order", () => {
    const config = parseRecordingConfig({
      ...base,
      rhythm: "paroxysmal_af",
      afEpisodes: [
        { startSec: 50, endSec: 60 },
        { startSec: 5, endSec: 10 },
      ],
    });
    expect(afEpisodesOf(config)).toEqual([
      { startSec: 5, endSec: 10 },
      { startSec: 50, endSec: 60 },
    ]);
  });
});

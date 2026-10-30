import { describe, expect, test } from "bun:test";

import { IDLE_STATUS } from "./live-conditioning";
import {
  BODYPARTS3D_BREATH_NOTE,
  CHAMBERS_ILLUSTRATIVE,
  CHAMBERS_LINE,
  BODYPARTS3D_HEART_NOTE,
  ILLUSTRATIVE,
  NO_RATE,
  readingAge,
  SHOW_ORGANS,
} from "./live-copy";
import { liveLines, liveNote } from "./live-lines";
import { NO_LIVE_VITALS, type LiveVitals } from "./live-rates";

const TODAY = "2026-10-20";

const VITALS: LiveVitals = {
  heart: {
    perMinute: 61,
    day: "2025-03-14",
    source: "Synthetic person 1",
    vital: "heartRate",
  },
  breath: {
    perMinute: 15,
    day: "2026-10-17",
    source: "Synthetic person 1",
    vital: "respiration",
  },
  hrvBelow: { latest: 36, median: 48, day: "2026-10-20", source: "Oura" },
};

describe("readingAge", () => {
  test("plain words at fixed dates", () => {
    expect(readingAge("2026-10-20", TODAY)).toBe("today");
    expect(readingAge("2026-10-19", TODAY)).toBe("1 day ago");
    expect(readingAge("2026-10-17", TODAY)).toBe("3 days ago");
    expect(readingAge("2026-09-21", TODAY)).toBe("29 days ago");
    expect(readingAge("2026-09-20", TODAY)).toBe("1 month ago");
    expect(readingAge("2026-05-20", TODAY)).toBe("5 months ago");
    expect(readingAge("2025-10-21", TODAY)).toBe("11 months ago");
    expect(readingAge("2025-03-14", TODAY)).toBe("1 year ago");
    expect(readingAge("2024-10-01", TODAY)).toBe("2 years ago");
  });

  test("a date after today or no date at all is said so", () => {
    expect(readingAge("2026-10-21", TODAY)).toBe("a date after today");
    expect(readingAge("unknown", TODAY)).toBe("date unknown");
  });
});

describe("liveLines", () => {
  const on = (pulsing: boolean, breathing: boolean, glowing: boolean) => ({
    pulsing,
    breathing,
    glowing,
    chambers: null,
  });

  test("nothing live, nothing said", () => {
    expect(liveLines(IDLE_STATUS, VITALS, "hra", TODAY)).toEqual([]);
  });

  test("every rate line says it is the last reading and how old it is", () => {
    expect(liveLines(on(true, true, false), VITALS, "hra", TODAY)).toEqual([
      "Illustrative, not a physiological simulation.",
      "Pulse at 61 bpm · last reading 14 Mar 2025 (1 year ago) · Synthetic person 1 heart rate",
      "Breathing at 15 per minute · last reading 17 Oct 2026 (3 days ago) · Synthetic person 1 respiratory rate",
    ]);
  });

  test("BodyParts3D says why whole systems glow", () => {
    expect(liveLines(on(true, true, false), VITALS, "bodyparts3d", TODAY)).toEqual([
      ILLUSTRATIVE,
      "Pulse at 61 bpm · last reading 14 Mar 2025 (1 year ago) · Synthetic person 1 heart rate",
      BODYPARTS3D_HEART_NOTE,
      "Breathing at 15 per minute · last reading 17 Oct 2026 (3 days ago) · Synthetic person 1 respiratory rate",
      BODYPARTS3D_BREATH_NOTE,
    ]);
  });

  test("the HRV line names both numbers, the reading's date and age, and the source", () => {
    const lines = liveLines(on(false, false, true), VITALS, "hra", TODAY);
    expect(lines).toEqual([
      ILLUSTRATIVE,
      "Soft glow on the brain: HRV below this person's usual level · 36 ms, last reading 20 Oct 2026 (today) · usual level 48 ms, median of the previous 28 days · Oura",
    ]);
    expect(lines.join(" ").toLowerCase()).not.toContain("stress");
    expect(liveLines(on(false, false, true), VITALS, "bodyparts3d", TODAY)[1]).toContain(
      "Soft glow on the nervous system:",
    );
  });

  test("beating chambers say it is an illustrative simulation and where the beat times come from", () => {
    const beating = { ...on(true, false, false), chambers: "sinus" } as const;
    const pulse =
      "Pulse at 61 bpm · last reading 14 Mar 2025 (1 year ago) · Synthetic person 1 heart rate";
    expect(liveLines(beating, VITALS, "hra", TODAY, "sinus")).toEqual([
      "Illustrative simulation, not a physiological model.",
      pulse,
      "Heart chambers: the region where the atria sit contracts, then the ventricles' region 160 ms later (an illustrative delay). The atlas heart is one mesh, so the regions are approximate.",
      "Beat timing: a simulated sinus rhythm with beat-to-beat variation from the rhythm simulator, paced to the heart rate above.",
    ]);
    expect(liveLines(beating, VITALS, "hra", TODAY, "regular")[3]).toBe(
      "Beat timing: regular, at the heart rate above. The wearable gives a rate, not the time of each beat.",
    );
    const fibrillating = { ...beating, chambers: "af" } as const;
    expect(liveLines(fibrillating, VITALS, "hra", TODAY, "paroxysmal_af")).toEqual([
      CHAMBERS_ILLUSTRATIVE,
      pulse,
      CHAMBERS_LINE,
      "Beat timing: simulated by the rhythm simulator with an episode of atrial fibrillation, because this synthetic person's record lists it on that day. Now: atrial fibrillation, so the atria quiver and the beats come irregularly.",
    ]);
    expect(liveLines(beating, VITALS, "hra", TODAY, "paroxysmal_af")[3]).toEndWith(
      "Now: sinus rhythm.",
    );
  });

  test("resting heart rate is named as such", () => {
    const rhr: LiveVitals = {
      ...VITALS,
      heart: { perMinute: 52, day: "2026-10-18", source: "Whoop", vital: "rhr" },
    };
    expect(liveLines(on(true, false, false), rhr, "hra", TODAY)[1]).toBe(
      "Pulse at 52 bpm · last reading 18 Oct 2026 (2 days ago) · Whoop resting heart rate",
    );
  });
});

describe("liveNote", () => {
  const environment = { on: true, inEnvironment: true, reducedMotion: false };
  const pulsing = { ...IDLE_STATUS, pulsing: true };

  test("no rate: one short line in the environment, nothing inline", () => {
    expect(liveNote(IDLE_STATUS, NO_LIVE_VITALS, environment)).toBe(NO_RATE);
    expect(NO_RATE).toBe("No heart rate on record for this subject.");
    expect(
      liveNote(IDLE_STATUS, NO_LIVE_VITALS, { ...environment, inEnvironment: false }),
    ).toBeNull();
  });

  test("a rate with no organ drawn says where to look", () => {
    expect(liveNote(IDLE_STATUS, VITALS, environment)).toBe(SHOW_ORGANS);
    expect(liveNote(IDLE_STATUS, VITALS, { ...environment, on: false })).toBeNull();
  });

  test("while something moves the rate lines speak instead", () => {
    expect(liveNote(pulsing, VITALS, environment)).toBeNull();
  });

  test("reduced motion stays quiet", () => {
    expect(
      liveNote(IDLE_STATUS, NO_LIVE_VITALS, { ...environment, reducedMotion: true }),
    ).toBeNull();
  });
});

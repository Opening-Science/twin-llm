import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";
import { type BeatLabel } from "@/packages/rhythm-sim/ectopic-beats";
import { simulateRecording } from "@/packages/rhythm-sim/simulate-recording";

import type { QueryToolPorts, SubjectScopeRow } from "./ports";
import { NO_RHYTHM_DATA } from "./refusals";
import { PROFILE_SHARES, recordingConfigFor, rhythmProfileOf } from "./rhythm-recording";
import { describeRecording, RESEARCH_THRESHOLD_LABEL } from "./rhythm-tools";
import { rhythmIrregularityInput } from "./schemas";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import { beatWindows, irregularityWindow } from "./stats";
import { runRhythmIrregularity } from "./tools";

/**
 * `rhythm_irregularity` over recordings made by packages/rhythm-sim. The
 * subject refs below were picked for their profiles: "a" is sinus, "b"
 * paroxysmal AF and "c" persistent AF (rhythmProfileOf).
 */

const SINUS = "a";
const PAROXYSMAL = "b";
const PERSISTENT = "c";
const UNLISTED = "unlisted-cohort-subject";

const SUBJECTS: Readonly<Record<string, SubjectScopeRow>> = {
  [SINUS]: { isSynthetic: true, cohortId: "synthea-v4-seed42" },
  [PAROXYSMAL]: { isSynthetic: true, cohortId: "synthea-v4-seed42" },
  [PERSISTENT]: { isSynthetic: true, cohortId: "synthea-v4-seed42" },
  [UNLISTED]: { isSynthetic: true, cohortId: "synthea-unlisted" },
};

const fakePorts = () => {
  const audits: AppendInput[] = [];
  const lookups: string[] = [];
  const ports: QueryToolPorts = {
    findSubject: async (subjectRef) => {
      lookups.push(subjectRef);
      return SUBJECTS[subjectRef] ?? null;
    },
    findObservations: async () => {
      throw new Error("rhythm_irregularity reads no observations");
    },
    findCohortObservations: async () => [],
    appendAudit: async (input) => {
      audits.push(input);
    },
  };
  return { ports, audits, lookups };
};

const synthetic: SessionScope = { actor: "local", sessionId: "turn", mode: "synthetic" };
const personal: SessionScope = { actor: "local", sessionId: "turn", mode: "personal" };

const input = (subjectRef: string) =>
  ({ subject_ref: subjectRef, recording: 1, duration_sec: 300 }) as const;

describe("rhythmProfileOf and recordingConfigFor", () => {
  test("a subject's profile and settings are fixed by its subject_ref", () => {
    expect(rhythmProfileOf("synthetic-rhythm-subject")).toEqual({
      profile: "sinus",
      meanHr: 71,
      rrSdMs: 37,
      respRateHz: 0.27,
      afMeanHr: 93,
      afCv: 0.15,
    });
    expect(recordingConfigFor("synthetic-rhythm-subject", 1, 300)).toEqual({
      seed: 3340879659,
      durationSec: 300,
      meanHr: 71,
      rrSdMs: 37,
      respRateHz: 0.27,
      afMeanHr: 93,
      afCv: 0.15,
      rhythm: "sinus",
      pacCount: 0,
      pvcCount: 1,
    });
  });

  test("over 1000 refs the profiles come out near 60 / 25 / 15 %: 593, 243, 164", () => {
    const counts = Array.from({ length: 1000 }, (_, i) =>
      rhythmProfileOf(`subject-${i}`),
    ).reduce((tally, each) => ({ ...tally, [each.profile]: tally[each.profile] + 1 }), {
      sinus: 0,
      paroxysmal_af: 0,
      af: 0,
    });
    expect(counts).toEqual({ sinus: 593, paroxysmal_af: 243, af: 164 });
    expect(PROFILE_SHARES.sinus + PROFILE_SHARES.paroxysmal_af + PROFILE_SHARES.af).toBe(
      1,
    );
  });

  test("a paroxysmal subject's episode lies inside the recording for every recording number", () => {
    for (let recording = 1; recording <= 50; recording += 1) {
      const config = recordingConfigFor(PAROXYSMAL, recording, 180);
      const episode = config.afEpisodes?.[0];
      expect(config.rhythm).toBe("paroxysmal_af");
      expect(
        episode !== undefined && episode.startSec >= 18 && episode.endSec <= 162,
      ).toBe(true);
    }
  });
});

describe("rhythmIrregularityInput", () => {
  test("closed: an unknown key, a recording of 0 and 120 s are refused", () => {
    expect(
      rhythmIrregularityInput.safeParse({ ...input(SINUS), rhythm: "af" }).success,
    ).toBe(false);
    expect(
      rhythmIrregularityInput.safeParse({ ...input(SINUS), recording: 0 }).success,
    ).toBe(false);
    expect(
      rhythmIrregularityInput.safeParse({ ...input(SINUS), duration_sec: 120 }).success,
    ).toBe(false);
    expect(rhythmIrregularityInput.safeParse(input(SINUS)).success).toBe(true);
  });
});

describe("runRhythmIrregularity", () => {
  test("personal mode: NO_RHYTHM_DATA before any read, audited with 0 rows", async () => {
    const { ports, audits, lookups } = fakePorts();
    expect(await runRhythmIrregularity(personal, input(SINUS), ports)).toEqual(
      NO_RHYTHM_DATA,
    );
    expect(lookups).toEqual([]);
    expect(audits.length).toBe(1);
    expect(audits[0]).toMatchObject({
      tool: "rhythm_irregularity",
      subjectRef: null,
      rowCount: 0,
    });
  });

  test("a subject outside the synthetic cohorts: SUBJECT_SCOPE_VIOLATION, 0 rows", async () => {
    const { ports, audits } = fakePorts();
    expect(await runRhythmIrregularity(synthetic, input(UNLISTED), ports)).toEqual(
      SUBJECT_SCOPE_VIOLATION,
    );
    expect(audits[0]).toMatchObject({ subjectRef: UNLISTED, rowCount: 0 });
  });

  test("sinus subject: 391 intervals, 3 windows, none flagged; audit counts 391", async () => {
    const { ports, audits } = fakePorts();
    const result = await runRhythmIrregularity(synthetic, input(SINUS), ports);
    expect(result).toEqual(describeRecording(input(SINUS)));
    expect(result).toMatchObject({
      subject_ref: SINUS,
      source: "simulated",
      n: 391,
      window_beats: 128,
      n_windows: 3,
      n_flagged: 0,
      flagged_time_share: 0,
      threshold: RESEARCH_THRESHOLD_LABEL,
      simulator_ground_truth: { profile: "sinus", af_interval_share: 0, pac: 0, pvc: 2 },
    });
    expect(audits[0]).toMatchObject({ subjectRef: SINUS, rowCount: 391 });
  });

  test("persistent AF subject: 483 intervals, all 3 windows flagged", async () => {
    const { ports } = fakePorts();
    expect(
      await runRhythmIrregularity(synthetic, input(PERSISTENT), ports),
    ).toMatchObject({
      n: 483,
      n_windows: 3,
      n_flagged: 3,
      flagged_time_share: 1,
      simulator_ground_truth: { profile: "af", af_interval_share: 1, pac: 0, pvc: 0 },
    });
  });

  test("paroxysmal subject: 1 of 3 windows flagged, about 31 % of the windowed time", async () => {
    const { ports } = fakePorts();
    const result = await runRhythmIrregularity(synthetic, input(PAROXYSMAL), ports);
    expect(result).toMatchObject({
      n: 422,
      n_windows: 3,
      n_flagged: 1,
      simulator_ground_truth: { profile: "paroxysmal_af", pac: 0, pvc: 1 },
    });
    expect("flagged_time_share" in result ? result.flagged_time_share : null).toBeCloseTo(
      0.3086,
      4,
    );
  });

  test("windows are consecutive: each starts where the last ended", () => {
    const result = describeRecording(input(PERSISTENT));
    const windows = "windows" in result ? result.windows : [];
    expect(windows.map((each) => each.start_sec)).toEqual([
      0,
      windows[0].end_sec,
      windows[1].end_sec,
    ]);
  });
});

/**
 * The research flag on simulator output with known labels: 50 seeds of
 * sinus (with up to 3 PACs and 2 PVCs), persistent AF and paroxysmal AF, 300 s
 * each, across rates and AF variability. A window counts as AF when every
 * interval in it is AF, sinus when none is, mixed otherwise. The simulated AF
 * is independent draws, which is what the turning-point test assumes, so this
 * checks the arithmetic against its own assumptions; it says nothing about
 * recordings of people.
 */
describe("separation on simulated recordings", () => {
  const tally = { af: [0, 0], sinus: [0, 0], mixed: [0, 0] };
  for (let seed = 1; seed <= 50; seed += 1) {
    for (const rhythm of ["sinus", "af", "paroxysmal_af"] as const) {
      const recording = simulateRecording({
        seed,
        durationSec: 300,
        rhythm,
        meanHr: 55 + (seed % 7) * 5,
        afMeanHr: 80 + (seed % 6) * 10,
        afCv: 0.15 + (seed % 5) * 0.025,
        pacCount: rhythm === "af" ? 0 : seed % 4,
        pvcCount: rhythm === "af" ? 0 : seed % 3,
      });
      const beats = recording.rrMs.map((rr, i) => ({ rr, label: recording.labels[i] }));
      for (const window of beatWindows(beats, 128)) {
        const af = window.filter(
          (beat) => beat.label === ("af" satisfies BeatLabel),
        ).length;
        const kind = af === window.length ? "af" : af === 0 ? "sinus" : "mixed";
        const flagged = irregularityWindow(window.map((beat) => beat.rr)).flagged;
        tally[kind] = [tally[kind][0] + 1, tally[kind][1] + (flagged ? 1 : 0)];
      }
    }
  }

  test("AF windows: 202 of 210 flagged (sensitivity 96.2 %)", () => {
    expect(tally.af).toEqual([210, 202]);
  });

  test("sinus windows, ectopic beats included: 0 of 128 flagged (specificity 100 %)", () => {
    expect(tally.sinus).toEqual([128, 0]);
  });

  test("mixed windows (an episode starts or ends inside): 33 of 91 flagged", () => {
    expect(tally.mixed).toEqual([91, 33]);
  });
});

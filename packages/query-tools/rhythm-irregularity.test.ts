import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";
import { type BeatLabel } from "@/packages/rhythm-sim/ectopic-beats";
import { simulateRecording } from "@/packages/rhythm-sim/simulate-recording";

import type {
  ClinicalQuery,
  ConditionRecord,
  QueryToolPorts,
  SubjectScopeRow,
} from "./ports";
import { NO_RHYTHM_DATA, outsideSubjectWindow } from "./refusals";
import {
  AF_SNOMED_CODE,
  type RecordingPlan,
  recordingConfigFor,
  rhythmGroundTruth,
  rhythmProfileOf,
  subjectRhythmSettings,
} from "./rhythm-recording";
import { describeRecording, RESEARCH_THRESHOLD_LABEL } from "./rhythm-tools";
import { rhythmIrregularityInput } from "./schemas";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import { beatWindows, irregularityWindow } from "./stats";
import { runRhythmIrregularity } from "./tools";

/**
 * `rhythm_irregularity` over recordings made by packages/rhythm-sim. Whether a
 * subject's recording has AF follows its record: "subject-af" has an AF
 * condition from 2025-03-01 to 2025-09-01, "subject-sinus" has none.
 */

const AF_SUBJECT = "subject-af";
const SINUS_SUBJECT = "subject-sinus";
const UNLISTED = "unlisted-cohort-subject";

const SUBJECTS: Readonly<Record<string, SubjectScopeRow>> = {
  [AF_SUBJECT]: { isSynthetic: true, cohortId: "synthea-v4-seed42" },
  [SINUS_SUBJECT]: { isSynthetic: true, cohortId: "synthea-v4-seed42" },
  [UNLISTED]: { isSynthetic: true, cohortId: "synthea-unlisted" },
};

const AF_CONDITION: ConditionRecord = {
  id: "c1",
  codeSystem: "http://snomed.info/sct",
  code: AF_SNOMED_CODE,
  display: "Atrial fibrillation",
  onsetAt: new Date("2025-03-01T00:00:00.000Z"),
  abatementAt: new Date("2025-09-01T00:00:00.000Z"),
  clinicalStatus: "resolved",
  verificationStatus: "confirmed",
};

const SPAN = {
  first: new Date("2024-01-01T08:00:00.000Z"),
  last: new Date("2025-12-31T08:00:00.000Z"),
};

const fakePorts = () => {
  const audits: AppendInput[] = [];
  const lookups: string[] = [];
  const conditionQueries: ClinicalQuery[] = [];
  const ports: QueryToolPorts = {
    findSubject: async (subjectRef) => {
      lookups.push(subjectRef);
      return SUBJECTS[subjectRef] ?? null;
    },
    findObservations: async () => {
      throw new Error("rhythm_irregularity reads no observation rows");
    },
    findCohortObservations: async () => [],
    findObservationSpan: async () => SPAN,
    findConditions: async (query) => {
      conditionQueries.push(query);
      // The conditions_timeline overlap rule, on the one AF record.
      const overlaps =
        query.subjectRef === AF_SUBJECT &&
        query.code === AF_SNOMED_CODE &&
        (AF_CONDITION.onsetAt?.getTime() ?? Infinity) <= query.end.getTime() &&
        (AF_CONDITION.abatementAt === null ||
          AF_CONDITION.abatementAt.getTime() >= query.start.getTime());
      return overlaps ? [AF_CONDITION] : [];
    },
    appendAudit: async (input) => {
      audits.push(input);
    },
  };
  return { ports, audits, lookups, conditionQueries };
};

const synthetic: SessionScope = { actor: "local", sessionId: "turn", mode: "synthetic" };
const personal: SessionScope = { actor: "local", sessionId: "turn", mode: "personal" };

const input = (subjectRef: string, date?: string) =>
  ({
    subject_ref: subjectRef,
    recording: 1,
    duration_sec: 300,
    ...(date === undefined ? {} : { date }),
  }) as const;

const plan = (subjectRef: string, afConditionActive: boolean): RecordingPlan => ({
  subjectRef,
  recording: 1,
  durationSec: 300,
  date: "2025-06-01",
  afConditionActive,
});

/** Any key that would hand a model the simulator's answer. */
const ANSWER_KEYS = /truth|profile|episode|label|af_|afinterval|pac|pvc|condition/i;

const keysOf = (value: unknown): string[] =>
  typeof value === "object" && value !== null
    ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
    : [];

describe("recording plan and ground truth", () => {
  test("an AF condition on the day gives paroxysmal AF; none gives sinus", () => {
    expect(rhythmProfileOf(AF_SUBJECT, true)).toBe("paroxysmal_af");
    expect(rhythmProfileOf(AF_SUBJECT, false)).toBe("sinus");
  });

  test("with an unrecorded-AF share of 1 every subject gets AF; the default share is 0", () => {
    expect(rhythmProfileOf(SINUS_SUBJECT, false, 1)).toBe("paroxysmal_af");
    expect(
      Array.from({ length: 200 }, (_, i) => rhythmProfileOf(`s-${i}`, false)).every(
        (profile) => profile === "sinus",
      ),
    ).toBe(true);
  });

  test("the config for one plan is fixed", () => {
    expect(subjectRhythmSettings(AF_SUBJECT)).toEqual({
      meanHr: 63,
      rrSdMs: 36,
      respRateHz: 0.27,
      afMeanHr: 107,
      afCv: 0.17,
    });
    expect(recordingConfigFor(plan(AF_SUBJECT, true))).toEqual({
      meanHr: 63,
      rrSdMs: 36,
      respRateHz: 0.27,
      afMeanHr: 107,
      afCv: 0.17,
      seed: 3911816428,
      durationSec: 300,
      pacCount: 2,
      pvcCount: 1,
      rhythm: "paroxysmal_af",
      afEpisodes: [{ startSec: 84, endSec: 145 }],
    });
  });

  test("rhythmGroundTruth says what the simulator made, for code only", () => {
    expect(rhythmGroundTruth(plan(AF_SUBJECT, true))).toEqual({
      profile: "paroxysmal_af",
      afEpisodes: [{ startSec: 84, endSec: 145 }],
      afIntervalShare: 110 / 361,
      pac: 2,
      pvc: 1,
    });
    expect(rhythmGroundTruth(plan(SINUS_SUBJECT, false))).toEqual({
      profile: "sinus",
      afEpisodes: [],
      afIntervalShare: 0,
      pac: 1,
      pvc: 1,
    });
  });

  test("an episode lies inside the recording for every recording number", () => {
    for (let recording = 1; recording <= 50; recording += 1) {
      const config = recordingConfigFor({
        ...plan(AF_SUBJECT, true),
        recording,
        durationSec: 180,
      });
      const episode = config.afEpisodes?.[0];
      expect(
        episode !== undefined && episode.startSec >= 18 && episode.endSec <= 162,
      ).toBe(true);
    }
  });
});

describe("rhythmIrregularityInput", () => {
  test("closed: an unknown key, a recording of 0, 120 s and a bad date are refused", () => {
    const base = input(SINUS_SUBJECT);
    expect(rhythmIrregularityInput.safeParse({ ...base, rhythm: "af" }).success).toBe(
      false,
    );
    expect(rhythmIrregularityInput.safeParse({ ...base, recording: 0 }).success).toBe(
      false,
    );
    expect(
      rhythmIrregularityInput.safeParse({ ...base, duration_sec: 120 }).success,
    ).toBe(false);
    expect(
      rhythmIrregularityInput.safeParse({ ...base, date: "2025-02-30" }).success,
    ).toBe(false);
    expect(
      rhythmIrregularityInput.safeParse({ ...base, date: "2025-06-01" }).success,
    ).toBe(true);
  });
});

describe("runRhythmIrregularity", () => {
  test("personal mode: NO_RHYTHM_DATA before any read, audited with 0 rows", async () => {
    const { ports, audits, lookups } = fakePorts();
    expect(await runRhythmIrregularity(personal, input(SINUS_SUBJECT), ports)).toEqual(
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

  test("a date outside the subject's observations: OUTSIDE_SUBJECT_WINDOW", async () => {
    const { ports } = fakePorts();
    expect(
      await runRhythmIrregularity(synthetic, input(SINUS_SUBJECT, "2026-01-01"), ports),
    ).toEqual(
      outsideSubjectWindow("2026-01-01", { start: "2024-01-01", end: "2025-12-31" }),
    );
  });

  test("no observations at all: OUTSIDE_SUBJECT_WINDOW with no window", async () => {
    const { ports } = fakePorts();
    const empty: QueryToolPorts = { ...ports, findObservationSpan: async () => null };
    expect(await runRhythmIrregularity(synthetic, input(SINUS_SUBJECT), empty)).toEqual(
      outsideSubjectWindow(null, { start: null, end: null }),
    );
  });

  test("AF on the record that day: the AF plan; the condition read is the day, code 49436004", async () => {
    const { ports, audits, conditionQueries } = fakePorts();
    const result = await runRhythmIrregularity(
      synthetic,
      input(AF_SUBJECT, "2025-06-01"),
      ports,
    );
    expect(result).toEqual(describeRecording(plan(AF_SUBJECT, true)));
    expect(result).toMatchObject({
      date: "2025-06-01",
      source: "simulated",
      n: 361,
      n_windows: 2,
      n_flagged: 1,
      threshold: RESEARCH_THRESHOLD_LABEL,
    });
    expect(conditionQueries).toEqual([
      {
        subjectRef: AF_SUBJECT,
        start: new Date("2025-06-01T00:00:00.000Z"),
        end: new Date("2025-06-01T23:59:59.999Z"),
        code: AF_SNOMED_CODE,
        take: 1,
      },
    ]);
    expect(audits[0]).toMatchObject({ subjectRef: AF_SUBJECT, rowCount: 361 });
  });

  test("the same subject after the condition abates, and on its default (last) day: sinus plan", async () => {
    const { ports } = fakePorts();
    const after = await runRhythmIrregularity(
      synthetic,
      input(AF_SUBJECT, "2025-10-01"),
      ports,
    );
    expect(after).toEqual(
      describeRecording({ ...plan(AF_SUBJECT, false), date: "2025-10-01" }),
    );
    const latest = await runRhythmIrregularity(synthetic, input(AF_SUBJECT), ports);
    expect(latest).toEqual(
      describeRecording({ ...plan(AF_SUBJECT, false), date: "2025-12-31" }),
    );
  });

  test("the output has no ground-truth field at any depth", async () => {
    const { ports, audits } = fakePorts();
    const result = await runRhythmIrregularity(
      synthetic,
      input(AF_SUBJECT, "2025-06-01"),
      ports,
    );
    expect(keysOf(result).filter((key) => ANSWER_KEYS.test(key))).toEqual([]);
    expect(Object.keys(result).sort()).toEqual([
      "date",
      "duration_sec",
      "flagged_time_share",
      "mean_hr",
      "n",
      "n_flagged",
      "n_windows",
      "recording",
      "source",
      "subject_ref",
      "threshold",
      "window_beats",
      "windows",
    ]);
    expect(audits[0]?.result).toEqual(result);
  });

  test("windows are consecutive: each starts where the last ended", () => {
    const result = describeRecording(plan(AF_SUBJECT, true));
    const windows = "windows" in result ? result.windows : [];
    expect(windows.map((each) => each.start_sec)).toEqual([0, windows[0].end_sec]);
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

  test("AF windows: 210 of 210 flagged (sensitivity 100 %)", () => {
    expect(tally.af).toEqual([210, 210]);
  });

  test("sinus windows, ectopic beats included: 0 of 128 flagged (specificity 100 %)", () => {
    expect(tally.sinus).toEqual([128, 0]);
  });

  test("mixed windows (an episode starts or ends inside): 41 of 91 flagged", () => {
    expect(tally.mixed).toEqual([91, 41]);
  });
});

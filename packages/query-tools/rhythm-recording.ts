/**
 * Which simulated recording `rhythm_irregularity` describes, and what the
 * simulator put in it. Synthetic recordings are not stored in the warehouse,
 * so the tool makes one with packages/rhythm-sim, the same way every time,
 * from the subject_ref, the recording day, the recording number and whether
 * the subject's Synthea record has atrial fibrillation (SNOMED CT 49436004)
 * on that day, as the synthetic wearables v3 do (#245). Pure.
 *
 * The ground truth (`rhythmGroundTruth`) is for scorers and benchmarks in code.
 * It is never part of the tool's output, so a model cannot read the answer.
 */
import { hash32, randomFor } from "@/infrastructure/seeded-random";
import { type BeatLabel } from "@/packages/rhythm-sim/ectopic-beats";
import { type RecordingConfigInput } from "@/packages/rhythm-sim/recording-config";
import { simulateRecording } from "@/packages/rhythm-sim/simulate-recording";

/** Synthea's atrial fibrillation code, the one wearables v3 reads. */
export const AF_SNOMED_CODE = "49436004";

/**
 * Share of subjects without an AF condition who still get AF in their
 * recordings (AF nobody recorded). Assumption, 0 by default: every AF
 * recording then belongs to a subject whose record has AF that day.
 */
export const UNRECORDED_AF_SHARE = 0;

export const RHYTHM_PROFILES = ["sinus", "paroxysmal_af"] as const;
export type RhythmProfile = (typeof RHYTHM_PROFILES)[number];

export type RecordingPlan = Readonly<{
  subjectRef: string;
  recording: number;
  durationSec: number;
  /** The recording day, YYYY-MM-DD. */
  date: string;
  /** An AF condition in the subject's record overlaps that day. */
  afConditionActive: boolean;
}>;

const between = (low: number, high: number, u: number): number => low + (high - low) * u;

/**
 * Paroxysmal AF when the record has AF that day (Synthea's record says nothing
 * of persistence, so no subject gets persistent AF; assumption), otherwise
 * sinus with ectopic beats, except an UNRECORDED_AF_SHARE of subjects.
 */
export const rhythmProfileOf = (
  subjectRef: string,
  afConditionActive: boolean,
  unrecordedShare = UNRECORDED_AF_SHARE,
): RhythmProfile =>
  afConditionActive || randomFor(hash32(subjectRef), "unrecorded-af")() < unrecordedShare
    ? "paroxysmal_af"
    : "sinus";

/** A subject's own rates and variability, the same in every recording. */
export const subjectRhythmSettings = (
  subjectRef: string,
): Readonly<{
  meanHr: number;
  rrSdMs: number;
  respRateHz: number;
  afMeanHr: number;
  afCv: number;
}> => {
  const random = randomFor(hash32(subjectRef), "rhythm-profile");
  return {
    meanHr: Math.round(between(55, 85, random())),
    rrSdMs: Math.round(between(25, 55, random())),
    respRateHz: Math.round(between(0.2, 0.3, random()) * 100) / 100,
    afMeanHr: Math.round(between(80, 130, random())),
    afCv: Math.round(between(0.15, 0.25, random()) * 100) / 100,
  };
};

/**
 * The simulator config for one recording. A paroxysmal recording has one AF
 * episode starting 10 to 50 % into it and lasting 20 to 40 % of it
 * (assumption); every recording may have up to 3 PACs and 2 PVCs in sinus.
 */
export const recordingConfigFor = (plan: RecordingPlan): RecordingConfigInput => {
  const random = randomFor(
    plan.recording,
    `rhythm-recording:${plan.subjectRef}:${plan.date}`,
  );
  const pacCount = Math.floor(random() * 4);
  const pvcCount = Math.floor(random() * 3);
  const episodeStart = Math.round(between(0.1, 0.5, random()) * plan.durationSec);
  const episodeLength = Math.round(between(0.2, 0.4, random()) * plan.durationSec);
  const common = {
    ...subjectRhythmSettings(plan.subjectRef),
    seed: hash32(`${plan.subjectRef}:${plan.date}:${plan.recording}`),
    durationSec: plan.durationSec,
    pacCount,
    pvcCount,
  };
  return rhythmProfileOf(plan.subjectRef, plan.afConditionActive) === "sinus"
    ? { ...common, rhythm: "sinus" }
    : {
        ...common,
        rhythm: "paroxysmal_af",
        afEpisodes: [{ startSec: episodeStart, endSec: episodeStart + episodeLength }],
      };
};

export type RhythmGroundTruth = Readonly<{
  profile: RhythmProfile;
  afEpisodes: ReadonlyArray<Readonly<{ startSec: number; endSec: number }>>;
  /** Share of RR intervals the simulator made in AF. */
  afIntervalShare: number;
  pac: number;
  pvc: number;
}>;

const countOf = (labels: readonly BeatLabel[], label: BeatLabel): number =>
  labels.filter((each) => each === label).length;

/**
 * What the simulator put in one recording, for scorers and benchmarks only.
 * The caller supplies `afConditionActive` from the subject's record.
 */
export const rhythmGroundTruth = (plan: RecordingPlan): RhythmGroundTruth => {
  const recording = simulateRecording(recordingConfigFor(plan));
  return {
    profile: rhythmProfileOf(plan.subjectRef, plan.afConditionActive),
    afEpisodes: recording.afEpisodes,
    afIntervalShare: countOf(recording.labels, "af") / recording.labels.length,
    pac: countOf(recording.labels, "pac"),
    pvc: countOf(recording.labels, "pvc"),
  };
};

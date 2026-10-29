/**
 * Which simulated recording `rhythm_irregularity` describes. Synthetic
 * recordings are not stored in the warehouse, so the tool makes one with
 * packages/rhythm-sim from the subject_ref and the recording number, the same
 * way every time. The subject's rhythm profile (mostly sinus, some paroxysmal
 * AF, some persistent AF) is drawn from the subject_ref alone and is a
 * simulator setting, not anything in the subject's record. Pure.
 */
import { hash32, randomFor } from "@/infrastructure/seeded-random";
import { type RecordingConfigInput } from "@/packages/rhythm-sim/recording-config";

export const RHYTHM_PROFILES = ["sinus", "paroxysmal_af", "af"] as const;
export type RhythmProfile = (typeof RHYTHM_PROFILES)[number];

/** Share of synthetic subjects given each profile. */
export const PROFILE_SHARES = { sinus: 0.6, paroxysmal_af: 0.25, af: 0.15 } as const;

const between = (low: number, high: number, u: number): number => low + (high - low) * u;

/** A subject's profile and per-subject settings; the same for every recording. */
export const rhythmProfileOf = (
  subjectRef: string,
): Readonly<{
  profile: RhythmProfile;
  meanHr: number;
  rrSdMs: number;
  respRateHz: number;
  afMeanHr: number;
  afCv: number;
}> => {
  const random = randomFor(hash32(subjectRef), "rhythm-profile");
  const pick = random();
  const profile: RhythmProfile =
    pick < PROFILE_SHARES.sinus
      ? "sinus"
      : pick < PROFILE_SHARES.sinus + PROFILE_SHARES.paroxysmal_af
        ? "paroxysmal_af"
        : "af";
  return {
    profile,
    meanHr: Math.round(between(55, 85, random())),
    rrSdMs: Math.round(between(25, 55, random())),
    respRateHz: Math.round(between(0.2, 0.3, random()) * 100) / 100,
    afMeanHr: Math.round(between(80, 130, random())),
    afCv: Math.round(between(0.15, 0.25, random()) * 100) / 100,
  };
};

/** The simulator config for one recording of one subject. */
export const recordingConfigFor = (
  subjectRef: string,
  recording: number,
  durationSec: number,
): RecordingConfigInput => {
  const subject = rhythmProfileOf(subjectRef);
  const random = randomFor(recording, `rhythm-recording:${subjectRef}`);
  const pacCount = Math.floor(random() * 4);
  const pvcCount = Math.floor(random() * 3);
  const episodeStart = Math.round(between(0.1, 0.5, random()) * durationSec);
  const episodeLength = Math.round(between(0.2, 0.4, random()) * durationSec);
  const common = {
    seed: hash32(`${subjectRef}:${recording}`),
    durationSec,
    meanHr: subject.meanHr,
    rrSdMs: subject.rrSdMs,
    respRateHz: subject.respRateHz,
    afMeanHr: subject.afMeanHr,
    afCv: subject.afCv,
  };
  switch (subject.profile) {
    case "sinus":
      return { ...common, rhythm: "sinus", pacCount, pvcCount };
    case "af":
      return { ...common, rhythm: "af" };
    case "paroxysmal_af":
      return {
        ...common,
        rhythm: "paroxysmal_af",
        pacCount,
        pvcCount,
        afEpisodes: [{ startSec: episodeStart, endSec: episodeStart + episodeLength }],
      };
  }
};

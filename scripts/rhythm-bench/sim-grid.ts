/**
 * The simulated grid: recording length × rhythm × ventricular rate in AF ×
 * beat-detection noise, and one seeded recording per cell and seed. Pure.
 *
 * Sinus rates and variability come from `subjectRhythmSettings` of the tool
 * (packages/query-tools/rhythm-recording.ts) for a benchmark id per seed, so
 * each seed is a different simulated profile. The AF rate is a grid factor
 * and overrides the profile's. Every level here is an assumption chosen to
 * span the simulator's range, not a population estimate.
 */
import { hash32, randomFor } from "@/infrastructure/seeded-random";
import { subjectRhythmSettings } from "@/packages/query-tools/rhythm-recording";
import { type AfDependence } from "@/packages/rhythm-sim/af-interval";
import { type RecordingConfigInput } from "@/packages/rhythm-sim/recording-config";

import { NO_PERTURBATION, type Perturbation } from "./perturb";

export const DURATIONS_SEC = [30, 60, 120, 300] as const;

export type RhythmCondition = Readonly<{
  id: string;
  kind: "sinus" | "paroxysmal_af" | "af";
  /** Ectopic beats per minute of recording (sinus only). */
  pacPerMin: number;
  pvcPerMin: number;
  /** Share of the recording in one AF episode (paroxysmal only). */
  burden: number;
}>;

export const RHYTHM_CONDITIONS: readonly RhythmCondition[] = [
  { id: "sinus", kind: "sinus", pacPerMin: 0, pvcPerMin: 0, burden: 0 },
  { id: "sinus+ectopy-2/1", kind: "sinus", pacPerMin: 2, pvcPerMin: 1, burden: 0 },
  { id: "sinus+ectopy-6/3", kind: "sinus", pacPerMin: 6, pvcPerMin: 3, burden: 0 },
  {
    id: "paroxysmal-10%",
    kind: "paroxysmal_af",
    pacPerMin: 0,
    pvcPerMin: 0,
    burden: 0.1,
  },
  {
    id: "paroxysmal-30%",
    kind: "paroxysmal_af",
    pacPerMin: 0,
    pvcPerMin: 0,
    burden: 0.3,
  },
  {
    id: "paroxysmal-60%",
    kind: "paroxysmal_af",
    pacPerMin: 0,
    pvcPerMin: 0,
    burden: 0.6,
  },
  { id: "persistent", kind: "af", pacPerMin: 0, pvcPerMin: 0, burden: 1 },
];

export const AF_RATES = [70, 100, 130] as const;

export type NoiseLevel = Readonly<{ id: string } & Perturbation>;

export const NOISE_LEVELS: readonly NoiseLevel[] = [
  { id: "none", ...NO_PERTURBATION },
  { id: "light", dropShare: 0.01, spuriousShare: 0.01, jitterSdMs: 4 },
  { id: "heavy", dropShare: 0.05, spuriousShare: 0.05, jitterSdMs: 15 },
];

export type GridCell = Readonly<{
  durationSec: number;
  rhythm: RhythmCondition;
  /** Ventricular rate in AF; null for sinus conditions, where it does not apply. */
  afRate: number | null;
  noise: NoiseLevel;
}>;

export type GridOptions = Readonly<{
  durations: readonly number[];
  rhythms: readonly RhythmCondition[];
  afRates: readonly number[];
  noise: readonly NoiseLevel[];
}>;

export const FULL_GRID: GridOptions = {
  durations: DURATIONS_SEC,
  rhythms: RHYTHM_CONDITIONS,
  afRates: AF_RATES,
  noise: NOISE_LEVELS,
};

export const gridCells = (options: GridOptions): GridCell[] =>
  options.durations.flatMap((durationSec) =>
    options.rhythms.flatMap((rhythm) =>
      (rhythm.kind === "sinus" ? [null] : options.afRates).flatMap((afRate) =>
        options.noise.map((noise) => ({ durationSec, rhythm, afRate, noise })),
      ),
    ),
  );

export const cellId = (cell: GridCell): string =>
  `${cell.durationSec}s|${cell.rhythm.id}|${cell.afRate ?? "-"}|${cell.noise.id}`;

/** A stable seed for one cell and benchmark seed (the noise level does not change the beats). */
export const recordingSeed = (cell: GridCell, seed: number): number =>
  hash32(
    `rhythm-bench:${cell.durationSec}:${cell.rhythm.id}:${cell.afRate ?? "-"}:${seed}`,
  );

const roundTenth = (value: number): number => Math.round(value * 10) / 10;

export const recordingConfigForCell = (
  cell: GridCell,
  seed: number,
  afDependence: AfDependence = "independent",
): RecordingConfigInput => {
  const settings = subjectRhythmSettings(`rhythm-bench-profile-${seed}`);
  const recordingSeedValue = recordingSeed(cell, seed);
  const common = {
    seed: recordingSeedValue,
    durationSec: cell.durationSec,
    meanHr: settings.meanHr,
    rrSdMs: settings.rrSdMs,
    respRateHz: settings.respRateHz,
    afCv: settings.afCv,
    afMeanHr: cell.afRate ?? settings.afMeanHr,
    afDependence,
  };
  switch (cell.rhythm.kind) {
    case "sinus":
      return {
        ...common,
        rhythm: "sinus",
        pacCount: Math.round((cell.rhythm.pacPerMin * cell.durationSec) / 60),
        pvcCount: Math.round((cell.rhythm.pvcPerMin * cell.durationSec) / 60),
      };
    case "af":
      return { ...common, rhythm: "af" };
    case "paroxysmal_af": {
      const length = roundTenth(cell.rhythm.burden * cell.durationSec);
      const start = roundTenth(
        randomFor(recordingSeedValue, "episode-start")() * (cell.durationSec - length),
      );
      return {
        ...common,
        rhythm: "paroxysmal_af",
        afEpisodes: [
          { startSec: start, endSec: Math.min(cell.durationSec, start + length) },
        ],
      };
    }
  }
};

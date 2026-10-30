/**
 * One simulated recording: beat times, RR intervals, the simulator's own label
 * for every beat, and a pulse-wave proxy. A statistical model of RR intervals,
 * not a physiological heart model (docs/rhythm-sim.md). Pure and seeded: the
 * same config gives the same recording, and each part draws from its own
 * stream, so turning on ectopy does not move the sinus phases.
 */
import { normal, randomFor } from "@/infrastructure/seeded-random";

import { afInterval, logNormalFor } from "./af-interval";
import { type BeatLabel, insertEctopicBeats } from "./ectopic-beats";
import { type PulseWave, pulseWave } from "./pulse-wave";
import {
  type AfEpisode,
  afEpisodesOf,
  parseRecordingConfig,
  type RecordingConfig,
  type RecordingConfigInput,
} from "./recording-config";
import { modulationAt, modulationComponents } from "./sinus-modulation";

/** Shortest sinus interval, ms; a guard on extreme settings (assumption). */
export const SINUS_MIN_RR_MS = 300;

export type Recording = Readonly<{
  config: RecordingConfig;
  afEpisodes: readonly AfEpisode[];
  /** Beat times from the first beat, ms; one more than `rrMs`. */
  beatTimesMs: readonly number[];
  /** `rrMs[i]` = `beatTimesMs[i + 1] − beatTimesMs[i]`, whole ms. */
  rrMs: readonly number[];
  /** Simulator ground truth for the beat that ends `rrMs[i]`. Metadata, not a finding. */
  labels: readonly BeatLabel[];
  /** 60000 / mean RR. */
  meanHr: number;
  pulseWave: PulseWave;
}>;

const inEpisode = (episodes: readonly AfEpisode[], tSec: number): boolean =>
  episodes.some((episode) => tSec >= episode.startSec && tSec < episode.endSec);

/** Sinus and AF intervals before ectopy, up to the end of the recording. */
const baseIntervals = (
  config: RecordingConfig,
  episodes: readonly AfEpisode[],
): Readonly<{ rrMs: number[]; labels: BeatLabel[] }> => {
  const meanRr = 60_000 / config.meanHr;
  const modulationSd = Math.sqrt(Math.max(0, config.rrSdMs ** 2 - config.noiseSdMs ** 2));
  const components = modulationComponents(
    {
      lfHz: config.lfHz,
      hfHz: config.respRateHz,
      peakWidthHz: config.peakWidthHz,
      lfHfRatio: config.lfHfRatio,
    },
    modulationSd,
    randomFor(config.seed, "sinus-phases"),
  );
  const sinusNoise = randomFor(config.seed, "sinus-noise");
  const afRandom = randomFor(config.seed, "af");
  const afShape = logNormalFor(60_000 / config.afMeanHr, config.afCv);
  const durationMs = config.durationSec * 1000;
  const rrMs: number[] = [];
  const labels: BeatLabel[] = [];
  for (let tMs = 0; ;) {
    const af = inEpisode(episodes, tMs / 1000);
    const interval = Math.round(
      af
        ? afInterval(afRandom, afShape)
        : Math.max(
            SINUS_MIN_RR_MS,
            meanRr +
              modulationAt(components, tMs / 1000) +
              config.noiseSdMs * normal(sinusNoise),
          ),
    );
    if (tMs + interval > durationMs) break;
    rrMs.push(interval);
    labels.push(af ? "af" : "sinus");
    tMs += interval;
  }
  return { rrMs, labels };
};

/** Beat times from intervals, the first beat at 0. */
export const beatTimesOf = (rrMs: readonly number[]): number[] => {
  const times = [0];
  for (const rr of rrMs) times.push((times.at(-1) ?? 0) + rr);
  return times;
};

export const simulateRecording = (input: RecordingConfigInput): Recording => {
  const config = parseRecordingConfig(input);
  const afEpisodes = afEpisodesOf(config);
  const { rrMs, labels } = insertEctopicBeats(
    baseIntervals(config, afEpisodes),
    config,
    randomFor(config.seed, "ectopy"),
  );
  const beatTimesMs = beatTimesOf(rrMs);
  const meanRr = rrMs.reduce((total, rr) => total + rr, 0) / rrMs.length;
  return {
    config,
    afEpisodes,
    beatTimesMs,
    rrMs,
    labels,
    meanHr: 60_000 / meanRr,
    pulseWave: pulseWave(
      {
        beatTimesMs,
        rrMs,
        durationSec: config.durationSec,
        meanSinusRrMs: 60_000 / config.meanHr,
        noise: config.pulseNoise,
        motionArtefact: config.motionArtefact,
      },
      randomFor(config.seed, "pulse"),
    ),
  };
};

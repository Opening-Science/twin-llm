/**
 * What a simulated recording is made from. Every default is listed in
 * docs/rhythm-sim.md with its source, or marked there as an assumption.
 * The schema is closed (`.strict()`), so a misspelt parameter fails instead of
 * silently falling back to a default.
 */
import { z } from "zod";

import { AF_DEPENDENCES } from "./af-interval";

export const RHYTHMS = ["sinus", "af", "paroxysmal_af"] as const;
export type Rhythm = (typeof RHYTHMS)[number];

export const MIN_DURATION_SEC = 30;
export const MAX_DURATION_SEC = 600;

const episodeSchema = z
  .object({
    startSec: z.number().min(0),
    endSec: z.number().positive(),
  })
  .strict()
  .refine((episode) => episode.endSec > episode.startSec, {
    error: "an episode must end after it starts",
  });

export const recordingConfigSchema = z
  .object({
    /** Unsigned 32-bit seed; the same seed and config give the same recording. */
    seed: z.number().int().min(0).max(0xffffffff),
    durationSec: z.number().int().min(MIN_DURATION_SEC).max(MAX_DURATION_SEC),
    rhythm: z.enum(RHYTHMS),
    /** Sinus rate, beats per minute. */
    meanHr: z.number().min(40).max(150).default(65),
    /** Total sinus RR standard deviation before ectopy, ms (modulation plus beat noise). */
    rrSdMs: z.number().min(5).max(150).default(40),
    /** Respiratory frequency, Hz; the high-frequency (RSA) peak sits here. */
    respRateHz: z.number().min(0.15).max(0.4).default(0.25),
    /** Low-frequency (Mayer wave) peak, Hz. */
    lfHz: z.number().min(0.04).max(0.15).default(0.1),
    /** LF power divided by HF power of the modulation. */
    lfHfRatio: z.number().min(0.1).max(5).default(0.5),
    /** Width (standard deviation) of each spectral peak, Hz. */
    peakWidthHz: z.number().min(0.002).max(0.05).default(0.01),
    /** White beat-to-beat noise in sinus rhythm, ms. */
    noiseSdMs: z.number().min(0).max(30).default(5),
    /** Ventricular rate during AF, beats per minute. */
    afMeanHr: z.number().min(50).max(180).default(100),
    /** Coefficient of variation of RR intervals during AF. */
    afCv: z.number().min(0.05).max(0.4).default(0.2),
    /**
     * How AF intervals depend on each other: independent draws, or short-range
     * dependence fitted to the MIT-BIH AF Database (#297).
     */
    afDependence: z.enum(AF_DEPENDENCES).default("independent"),
    /** AF episodes for `paroxysmal_af`; left out, one episode over the middle third. */
    afEpisodes: z.array(episodeSchema).max(10).optional(),
    /** Premature atrial and ventricular beats, placed in sinus rhythm. */
    pacCount: z.number().int().min(0).max(50).default(0),
    pvcCount: z.number().int().min(0).max(50).default(0),
    /** How much earlier than the sinus interval an ectopic beat comes (0.25 = 25 % shorter). */
    pacPrematurity: z.number().min(0.1).max(0.4).default(0.25),
    pvcPrematurity: z.number().min(0.1).max(0.4).default(0.25),
    /** Gaussian noise on the pulse-wave proxy, in pulse amplitudes. */
    pulseNoise: z.number().min(0).max(0.5).default(0.02),
    /** Adds one 5 s motion artefact to the pulse-wave proxy (beats are unchanged). */
    motionArtefact: z.boolean().default(false),
  })
  .strict()
  .superRefine((config, context) => {
    const episodes = config.afEpisodes ?? [];
    if (config.rhythm !== "paroxysmal_af" && episodes.length > 0) {
      context.addIssue({
        code: "custom",
        message: "afEpisodes is only for rhythm paroxysmal_af",
        path: ["afEpisodes"],
      });
    }
    const sorted = [...episodes].sort((a, b) => a.startSec - b.startSec);
    sorted.forEach((episode, index) => {
      if (episode.endSec > config.durationSec) {
        context.addIssue({
          code: "custom",
          message: "an AF episode ends after the recording",
          path: ["afEpisodes", index],
        });
      }
      const previous = sorted[index - 1];
      if (previous !== undefined && episode.startSec < previous.endSec) {
        context.addIssue({
          code: "custom",
          message: "AF episodes overlap",
          path: ["afEpisodes", index],
        });
      }
    });
  });

export type RecordingConfigInput = z.input<typeof recordingConfigSchema>;
export type RecordingConfig = Readonly<z.output<typeof recordingConfigSchema>>;

export type AfEpisode = Readonly<{ startSec: number; endSec: number }>;

/**
 * The AF episodes a config means: none for sinus, the whole recording for
 * persistent AF, the given ones (or the middle third) for paroxysmal AF.
 */
export const afEpisodesOf = (config: RecordingConfig): readonly AfEpisode[] => {
  switch (config.rhythm) {
    case "sinus":
      return [];
    case "af":
      return [{ startSec: 0, endSec: config.durationSec }];
    case "paroxysmal_af":
      return config.afEpisodes !== undefined && config.afEpisodes.length > 0
        ? [...config.afEpisodes].sort((a, b) => a.startSec - b.startSec)
        : [{ startSec: config.durationSec / 3, endSec: (2 * config.durationSec) / 3 }];
  }
};

/** Parses and fills defaults; throws a ZodError on a config outside its bounds. */
export const parseRecordingConfig = (input: RecordingConfigInput): RecordingConfig =>
  recordingConfigSchema.parse(input);

/**
 * The sinus RR process: spectral synthesis in the manner of the RR model in
 * ECGSYN (McSharry et al. 2003). The modulation's power spectrum is the sum of
 * two Gaussians, a low-frequency peak (Mayer waves, about 0.1 Hz) and a
 * high-frequency peak at the respiratory rate (respiratory sinus arrhythmia),
 * with a set LF/HF power ratio. It is realised as a sum of sinusoids with
 * seeded random phases, so it can be read at any beat time. Pure.
 */
import { type Random } from "@/infrastructure/seeded-random";

export type SpectrumParams = Readonly<{
  lfHz: number;
  hfHz: number;
  peakWidthHz: number;
  lfHfRatio: number;
}>;

/** Frequency spacing of the sinusoids, Hz; fine enough for a 600 s recording. */
export const SPECTRUM_STEP_HZ = 0.002;
/** Highest modulation frequency; above it the spectrum is negligible. */
export const SPECTRUM_MAX_HZ = 0.5;

export type Component = Readonly<{
  frequencyHz: number;
  amplitude: number;
  phase: number;
}>;

const gaussian = (x: number, centre: number, width: number): number =>
  Math.exp(-((x - centre) ** 2) / (2 * width ** 2)) / (width * Math.sqrt(2 * Math.PI));

/**
 * Power spectral density with unit total power: LF/HF of it in the LF peak and
 * the rest in the HF peak.
 */
export const modulationSpectrum = (
  params: SpectrumParams,
  frequencyHz: number,
): number => {
  const lfShare = params.lfHfRatio / (1 + params.lfHfRatio);
  return (
    lfShare * gaussian(frequencyHz, params.lfHz, params.peakWidthHz) +
    (1 - lfShare) * gaussian(frequencyHz, params.hfHz, params.peakWidthHz)
  );
};

/**
 * Sinusoids whose amplitudes follow the spectrum and whose total variance
 * (sum of amplitude² / 2) is `sdMs`². Phases come from `random`.
 */
export const modulationComponents = (
  params: SpectrumParams,
  sdMs: number,
  random: Random,
): readonly Component[] => {
  const count = Math.floor(SPECTRUM_MAX_HZ / SPECTRUM_STEP_HZ);
  const raw = Array.from({ length: count }, (_, index) => {
    const frequencyHz = (index + 1) * SPECTRUM_STEP_HZ;
    return {
      frequencyHz,
      amplitude: Math.sqrt(
        2 * modulationSpectrum(params, frequencyHz) * SPECTRUM_STEP_HZ,
      ),
      phase: 2 * Math.PI * random(),
    };
  });
  const variance = raw.reduce((total, part) => total + part.amplitude ** 2 / 2, 0);
  const scale = variance === 0 ? 0 : sdMs / Math.sqrt(variance);
  return raw.map((part) => ({ ...part, amplitude: part.amplitude * scale }));
};

/** The modulation, in ms, at time `tSec`. */
export const modulationAt = (components: readonly Component[], tSec: number): number =>
  components.reduce(
    (total, part) =>
      total +
      part.amplitude * Math.sin(2 * Math.PI * part.frequencyHz * tSec + part.phase),
    0,
  );

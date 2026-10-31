/**
 * Daily AF effects for generator v3.1, read from the AF resolution study
 * (#290, #365): `docs/research/af-resolution-2026-10.summary.json`,
 * `dailyEffects`, noise "none". For each simulated burden (2, 10, 30 and 60%
 * of the day) the study reports the median change, over 40 simulated
 * subjects, of the daily heart rate, the night resting heart rate and the
 * night RMSSD from the subject's own baseline, computed from simulated beats
 * (`packages/rhythm-sim`). Between those burdens the effect is interpolated
 * linearly; above 60% it follows the line through the 30% and 60% points,
 * which the study did not measure. Burden 0 is no effect, by definition (the
 * study's sinus days move by under 0.2 /min and 0.2%).
 *
 * Pure apart from the JSON import; `afDailyEffectAt` takes the points so a
 * test can pass its own.
 */
import summary from "../../docs/research/af-resolution-2026-10.summary.json";

export const AF_CALIBRATION_SOURCE = "docs/research/af-resolution-2026-10.summary.json";
/** The study's day aggregates on clean beats; light noise only adds beat-detection artefacts. */
export const AF_CALIBRATION_NOISE = "none";

export type AfDailyEffect = Readonly<{
  /** Share of the day in AF. */
  burden: number;
  /** Daily mean heart rate, change from baseline, /min. */
  heartRateChange: number;
  /** Night resting heart rate, change from baseline, /min. */
  restingHeartRateChange: number;
  /** Night RMSSD, ratio to baseline. */
  hrvRmssdRatio: number;
}>;

const NO_AF: AfDailyEffect = {
  burden: 0,
  heartRateChange: 0,
  restingHeartRateChange: 0,
  hrvRmssdRatio: 1,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * The AF burdens of a resolution study summary at one noise level, sorted by
 * burden, sinus days (burden 0) left out. Throws on a summary without them,
 * so a broken table fails at import rather than giving a silent zero.
 */
export const calibrationPoints = (
  value: unknown,
  noise: string = AF_CALIBRATION_NOISE,
): AfDailyEffect[] => {
  const rows = isRecord(value) ? value.dailyEffects : undefined;
  if (!Array.isArray(rows)) throw new Error(`${AF_CALIBRATION_SOURCE}: no dailyEffects`);
  const points = rows
    .filter(isRecord)
    .filter((row) => row.noise === noise && finite(row.burden) && row.burden > 0)
    .map((row): AfDailyEffect => {
      const { burden, heartRateChange, restingHeartRateChange, hrvRmssdRatio } = row;
      if (
        !finite(burden) ||
        !finite(heartRateChange) ||
        !finite(restingHeartRateChange) ||
        !finite(hrvRmssdRatio)
      ) {
        throw new Error(
          `${AF_CALIBRATION_SOURCE}: incomplete row at burden ${String(burden)}`,
        );
      }
      return { burden, heartRateChange, restingHeartRateChange, hrvRmssdRatio };
    })
    .toSorted((a, b) => a.burden - b.burden);
  if (points.length < 2) {
    throw new Error(
      `${AF_CALIBRATION_SOURCE}: fewer than two AF burdens at noise ${noise}`,
    );
  }
  return points;
};

/** The study's points, read once. */
export const AF_CALIBRATION: readonly AfDailyEffect[] = calibrationPoints(summary);

const between = (a: AfDailyEffect, b: AfDailyEffect, burden: number): AfDailyEffect => {
  const t = (burden - a.burden) / (b.burden - a.burden);
  const at = (pick: (point: AfDailyEffect) => number) =>
    pick(a) + t * (pick(b) - pick(a));
  return {
    burden,
    heartRateChange: at((point) => point.heartRateChange),
    restingHeartRateChange: at((point) => point.restingHeartRateChange),
    hrvRmssdRatio: at((point) => point.hrvRmssdRatio),
  };
};

/**
 * The daily effect at a burden: no effect at 0, linear between the study's
 * burdens (and from 0 to the lowest), and along the last segment above the
 * highest.
 */
export const afDailyEffectAt = (
  burden: number,
  points: readonly AfDailyEffect[] = AF_CALIBRATION,
): AfDailyEffect => {
  if (burden <= 0) return NO_AF;
  const nodes = [NO_AF, ...points];
  const upper = nodes.findIndex((point) => point.burden >= burden);
  const index = upper === -1 ? nodes.length - 1 : Math.max(1, upper);
  const a = nodes[index - 1] ?? NO_AF;
  const b = nodes[index] ?? NO_AF;
  return between(a, b, burden);
};

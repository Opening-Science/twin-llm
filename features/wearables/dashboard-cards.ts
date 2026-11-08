import type { WearableSource } from "./dashboard-headings";

/**
 * The stored series behind each wearables dashboard card, per source. The
 * cards themselves are built in `kit-cards.ts`.
 */

export type TrendSpec = Readonly<{ label: string; prefix: string }>;

export type DashboardTrends = Readonly<{
  heart: TrendSpec | null;
  sleep: TrendSpec | null;
  hrv: TrendSpec | null;
  steps: TrendSpec | null;
}>;

/**
 * The stored series each card follows. Oura's heart rate is the average
 * during sleep; Whoop and Google Health report a resting heart rate. All
 * three HRV series are RMSSD. Whoop has no steps and Google Health's sleep
 * has no fixed unit, so those cards do not exist for them.
 */
export const DASHBOARD_TRENDS: Readonly<Record<WearableSource, DashboardTrends>> = {
  oura: {
    heart: { label: "Heart rate during sleep", prefix: "sleep.hr." },
    sleep: { label: "Sleep duration", prefix: "sleep.duration." },
    hrv: { label: "HRV (RMSSD)", prefix: "sleep.hrv." },
    steps: { label: "Steps", prefix: "activity.steps." },
  },
  whoop: {
    heart: { label: "Resting HR", prefix: "whoop.recovery.rhr." },
    sleep: { label: "Time in bed", prefix: "whoop.sleep.in_bed_min." },
    hrv: { label: "HRV (RMSSD)", prefix: "whoop.recovery.hrv." },
    steps: null,
  },
  "google-health": {
    heart: { label: "Resting HR", prefix: "google.daily-resting-heart-rate." },
    sleep: null,
    hrv: { label: "HRV (RMSSD)", prefix: "google.daily-heart-rate-variability." },
    steps: { label: "Steps", prefix: "google.steps." },
  },
};

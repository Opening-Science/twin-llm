import type { WhoopSyncPayload } from "@open-twin/provider-whoop";
import type { WhoopMetric, WhoopSummary } from "@/infrastructure/whoop-types";

export type { WhoopMetric, WhoopSummary };

const dayKey = (iso?: string) => {
  if (!iso) return "unknown";
  return iso.slice(0, 10);
};

/**
 * Flattens Whoop recovery / cycle / sleep payloads into citation-friendly keys.
 */
export const buildWhoopSummary = (
  data: WhoopSyncPayload,
  window: { startDate: string; endDate: string },
): WhoopSummary => {
  const metrics: WhoopMetric[] = [];

  for (const row of data.recovery) {
    const day = dayKey(row.created_at);
    const score = row.score;
    if (!score) continue;
    if (score.recovery_score !== undefined) {
      metrics.push({
        key: `whoop.recovery.score.${day}`,
        label: `Whoop recovery score (${day})`,
        value: score.recovery_score,
        date: day,
      });
    }
    if (score.hrv_rmssd_milli !== undefined) {
      metrics.push({
        key: `whoop.recovery.hrv.${day}`,
        label: `Whoop HRV RMSSD (${day})`,
        value: Math.round(score.hrv_rmssd_milli * 10) / 10,
        date: day,
        unit: "ms",
      });
    }
    if (score.resting_heart_rate !== undefined) {
      metrics.push({
        key: `whoop.recovery.rhr.${day}`,
        label: `Whoop resting HR (${day})`,
        value: score.resting_heart_rate,
        date: day,
        unit: "bpm",
      });
    }
    if (score.spo2_percentage !== undefined) {
      metrics.push({
        key: `whoop.recovery.spo2.${day}`,
        label: `Whoop SpO2 (${day})`,
        value: Math.round(score.spo2_percentage * 10) / 10,
        date: day,
        unit: "%",
      });
    }
  }

  for (const row of data.cycles) {
    const day = dayKey(row.start);
    const score = row.score;
    if (!score) continue;
    if (score.strain !== undefined) {
      metrics.push({
        key: `whoop.cycle.strain.${day}`,
        label: `Whoop day strain (${day})`,
        value: Math.round(score.strain * 10) / 10,
        date: day,
      });
    }
    if (score.average_heart_rate !== undefined) {
      metrics.push({
        key: `whoop.cycle.avg_hr.${day}`,
        label: `Whoop cycle average HR (${day})`,
        value: score.average_heart_rate,
        date: day,
        unit: "bpm",
      });
    }
  }

  for (const row of data.sleep) {
    if (row.nap) continue;
    const day = dayKey(row.start);
    const score = row.score;
    if (!score) continue;
    if (score.sleep_performance_percentage !== undefined) {
      metrics.push({
        key: `whoop.sleep.performance.${day}`,
        label: `Whoop sleep performance (${day})`,
        value: score.sleep_performance_percentage,
        date: day,
        unit: "%",
      });
    }
    if (score.sleep_efficiency_percentage !== undefined) {
      metrics.push({
        key: `whoop.sleep.efficiency.${day}`,
        label: `Whoop sleep efficiency (${day})`,
        value: Math.round(score.sleep_efficiency_percentage * 10) / 10,
        date: day,
        unit: "%",
      });
    }
    if (score.sleep_consistency_percentage !== undefined) {
      metrics.push({
        key: `whoop.sleep.consistency.${day}`,
        label: `Whoop sleep consistency (${day})`,
        value: score.sleep_consistency_percentage,
        date: day,
        unit: "%",
      });
    }
    const inBed = score.stage_summary?.total_in_bed_time_milli;
    if (inBed !== undefined) {
      metrics.push({
        key: `whoop.sleep.in_bed_min.${day}`,
        label: `Whoop time in bed (${day})`,
        value: Math.round(inBed / 60_000),
        date: day,
        unit: "min",
      });
    }
  }

  const lines = metrics.slice(0, 80).map((m) => {
    const unit = m.unit ? ` ${m.unit}` : "";
    return `- [${m.key}] ${m.label}: ${m.value}${unit}`;
  });

  const narrative =
    metrics.length === 0
      ? "No Whoop metrics were available for this window."
      : [
          `Whoop wearable context for ${window.startDate} to ${window.endDate}.`,
          "Cite metrics by their [key] when they inform your answer.",
          ...lines,
        ].join("\n");

  return { window, metrics, narrative };
};

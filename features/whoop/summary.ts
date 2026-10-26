import { dayKey } from "@/infrastructure/day-key";
import type { WhoopHostPayload } from "@/infrastructure/open-twin-adapters/whoop";
import {
  WHOOP_HR_ZONES,
  whoopSportName,
} from "@/infrastructure/open-twin-adapters/whoop-workout";
import type { WhoopMetric, WhoopSummary } from "@/infrastructure/whoop-types";

export type { WhoopMetric, WhoopSummary };

/** A sport name as a citation key segment: lower case, letters, digits and `_` only. */
const keyPart = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || "workout";

/** Whole minutes between two instants, or null when either does not parse. */
const durationMinutes = (start: string, end: string): number | null => {
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) ? Math.round(ms / 60_000) : null;
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Flattens Whoop recovery / cycle / sleep / workout payloads into
 * citation-friendly keys.
 */
export const buildWhoopSummary = (
  data: WhoopHostPayload,
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

  // Several workouts can share a day, so the sport is part of the key, and a
  // second workout of the same sport on the same day gets `_2`, `_3`, ...
  const seen = new Map<string, number>();
  for (const workout of data.workouts) {
    const score = workout.score;
    if (!score) continue;
    const day = dayKey(workout.start);
    const sportName = whoopSportName(workout);
    const base = keyPart(sportName);
    const count = (seen.get(`${base}.${day}`) ?? 0) + 1;
    seen.set(`${base}.${day}`, count);
    const sport = count === 1 ? base : `${base}_${count}`;
    const push = (field: string, label: string, value: number, unit?: string) =>
      metrics.push({
        key: `whoop.workout.${field}.${sport}.${day}`,
        label: `Whoop workout ${label}, ${sportName} (${day})`,
        value,
        date: day,
        ...(unit ? { unit } : {}),
      });

    const minutes = durationMinutes(workout.start, workout.end);
    if (minutes !== null) push("duration", "duration", minutes, "min");
    if (score.strain !== undefined) push("strain", "strain", round1(score.strain));
    if (score.average_heart_rate !== undefined) {
      push("avg_hr", "average HR", score.average_heart_rate, "bpm");
    }
    if (score.max_heart_rate !== undefined) {
      push("max_hr", "max HR", score.max_heart_rate, "bpm");
    }
    if (score.kilojoule !== undefined) {
      push("kilojoules", "energy", Math.round(score.kilojoule), "kJ");
    }
    if (typeof score.distance_meter === "number") {
      push("distance", "distance", Math.round(score.distance_meter), "m");
    }
    for (const [zone, field] of WHOOP_HR_ZONES) {
      const ms = score.zone_durations?.[field];
      if (ms !== undefined) {
        push(
          `hr_zone_${zone}`,
          `time in HR zone ${zone}`,
          Math.round(ms / 60_000),
          "min",
        );
      }
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

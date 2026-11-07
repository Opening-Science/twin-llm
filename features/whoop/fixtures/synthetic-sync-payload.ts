import type { WhoopHostPayload } from "@/infrastructure/open-twin-adapters/whoop";

/**
 * Hand-written synthetic Whoop sync payload. No real wearer, device or vendor
 * record ids; values chosen so rounding and skip rules are observable.
 */
export const SYNTHETIC_WHOOP_PAYLOAD: WhoopHostPayload = {
  recovery: [
    {
      cycle_id: "1001",
      sleep_id: "sleep-a",
      created_at: "2026-01-02T07:00:00.000Z",
      score_state: "SCORED",
      score: {
        recovery_score: 64,
        resting_heart_rate: 52,
        hrv_rmssd_milli: 48.27,
        spo2_percentage: 96.44,
      },
    },
    {
      cycle_id: "1002",
      created_at: "2026-01-03T07:00:00.000Z",
      score_state: "SCORED",
      score: { recovery_score: 40 },
    },
    {
      cycle_id: "1003",
      created_at: "2026-01-04T07:00:00.000Z",
      score_state: "PENDING_SCORE",
    },
  ],
  cycles: [
    {
      id: "1001",
      start: "2026-01-01T06:30:00.000Z",
      end: "2026-01-02T06:30:00.000Z",
      score_state: "SCORED",
      score: { strain: 11.46, average_heart_rate: 71 },
    },
  ],
  sleep: [
    {
      id: "sleep-a",
      start: "2026-01-01T23:10:00.000Z",
      end: "2026-01-02T06:40:00.000Z",
      nap: false,
      score_state: "SCORED",
      score: {
        sleep_performance_percentage: 88,
        sleep_efficiency_percentage: 91.26,
        sleep_consistency_percentage: 77,
        stage_summary: { total_in_bed_time_milli: 27_000_000 },
      },
    },
    {
      id: "nap-1",
      start: "2026-01-02T13:00:00.000Z",
      nap: true,
      score: { sleep_performance_percentage: 50 },
    },
  ],
  workouts: [
    {
      id: "workout-a",
      start: "2026-01-02T17:00:00.000Z",
      end: "2026-01-02T17:45:30.000Z",
      sport_name: "running",
      score_state: "SCORED",
      score: {
        strain: 12.34,
        average_heart_rate: 148,
        max_heart_rate: 176,
        kilojoule: 2092,
        percent_recorded: 100,
        distance_meter: 8012.6,
        zone_durations: {
          zone_zero_milli: 60_000,
          zone_one_milli: 300_000,
          zone_two_milli: 600_000,
          zone_three_milli: 900_000,
          zone_four_milli: 720_000,
          zone_five_milli: 150_000,
        },
      },
    },
    {
      id: "workout-b",
      start: "2026-01-02T19:00:00.000Z",
      end: "2026-01-02T19:30:00.000Z",
      sport_name: "Running",
      score_state: "SCORED",
      score: { strain: 6, kilojoule: 800, distance_meter: null },
    },
    {
      id: "workout-c",
      start: "2026-01-03T08:00:00.000Z",
      end: "2026-01-03T09:00:00.000Z",
      sport_name: "functional-fitness",
      score_state: "PENDING_SCORE",
    },
  ],
};

export const SYNTHETIC_WINDOW = {
  startDate: "2026-01-01",
  endDate: "2026-01-04",
} as const;

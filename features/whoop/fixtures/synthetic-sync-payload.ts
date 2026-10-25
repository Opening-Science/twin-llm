import type { WhoopSyncPayload } from "@open-twin/provider-whoop";

/**
 * Hand-written synthetic Whoop sync payload. No real wearer, device or vendor
 * record ids; values chosen so rounding and skip rules are observable.
 */
export const SYNTHETIC_WHOOP_PAYLOAD: WhoopSyncPayload = {
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
};

export const SYNTHETIC_WINDOW = {
  startDate: "2026-01-01",
  endDate: "2026-01-04",
} as const;

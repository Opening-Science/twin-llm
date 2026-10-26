import type { OuraTypedData } from "@open-twin/provider-oura";

/**
 * Hand-written synthetic Oura responses in the v2 API shape, one per record type
 * this change adds to the sync. No real wearer, ring or vendor record ids. The
 * second record of each type leaves its optional fields out, so a test can show
 * that a missing value stays missing.
 */
export const SYNTHETIC_WINDOW = { startDate: "2026-01-01", endDate: "2026-01-04" };

export const SYNTHETIC_OURA_DATA: readonly OuraTypedData[] = [
  {
    type: "workout",
    data: {
      next_token: null,
      data: [
        {
          id: "workout-synthetic-1",
          activity: "running",
          source: "autodetected",
          intensity: "moderate",
          start_datetime: "2026-01-02T07:00:00+00:00",
          end_datetime: "2026-01-02T07:45:00+00:00",
          day: "2026-01-02",
          calories: 412,
          distance: 7250,
          label: "Morning run",
        },
        {
          id: "workout-synthetic-2",
          activity: "walking",
          source: "manual",
          intensity: "easy",
          start_datetime: "2026-01-03T18:00:00+00:00",
          end_datetime: "2026-01-03T18:30:00+00:00",
          day: "2026-01-03",
        },
      ],
    },
  },
  {
    type: "daily_spo2",
    data: {
      next_token: null,
      data: [
        {
          id: "spo2-synthetic-1",
          day: "2026-01-02",
          spo2_percentage: { average: 96.8 },
          breathing_disturbance_index: 3,
        },
        {
          id: "spo2-synthetic-2",
          day: "2026-01-03",
          spo2_percentage: null,
          breathing_disturbance_index: null,
        },
      ],
    },
  },
  {
    type: "daily_stress",
    data: {
      next_token: null,
      data: [
        {
          id: "stress-synthetic-1",
          day: "2026-01-02",
          day_summary: "normal",
          stress_high: 5400,
          recovery_high: 1800,
        },
        {
          id: "stress-synthetic-2",
          day: "2026-01-03",
        },
      ],
    },
  },
  {
    type: "vO2_max",
    data: {
      next_token: null,
      data: [
        {
          id: "vo2max-synthetic-1",
          day: "2026-01-02",
          timestamp: "2026-01-02T00:00:00+00:00",
          vo2_max: 41.5,
        },
        {
          id: "vo2max-synthetic-2",
          day: "2026-01-03",
          timestamp: "2026-01-03T00:00:00+00:00",
        },
      ],
    },
  },
];

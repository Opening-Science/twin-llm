import { personalBaseline } from "@/packages/query-tools/replay/baseline";
import {
  DEMO_PERSON_A,
  DEMO_TEN_DAYS,
  demoReplayDays,
} from "@/packages/query-tools/replay/demo-days";
import { storyPhases } from "@/packages/query-tools/replay/phases";
import { bandOf } from "@/packages/query-tools/replay/nights";
import { localInstant } from "@/packages/query-tools/replay/local-time";

import { replayTimeline } from "./your-day-replay-events";
import { type YourDayChartData } from "./your-day-charts";
import { type DayObservation } from "./your-day-observations";

export type YourDayDemo = ReturnType<typeof replayTimeline> &
  Readonly<{ chartData: YourDayChartData; observations?: readonly DayObservation[] }>;

export function yourDayReplayFixtures(): readonly YourDayDemo[] {
  const history = demoReplayDays(DEMO_PERSON_A);
  return history
    .filter((day) => DEMO_TEN_DAYS.includes(day.day))
    .map((day) => {
      const restingBaseline = personalBaseline(history, day, "resting_heart_rate");
      return {
        ...replayTimeline(day, storyPhases(day, { restingBaseline })),
        observations:
          day.day === "2026-10-27"
            ? [
                {
                  id: "demo-ferritin",
                  sourceId: "demo-lab",
                  source: "Synthetic demo lab",
                  codeSystem: "http://loinc.org",
                  code: "2276-4",
                  label: "Ferritin",
                  unit: "ng/mL",
                  day: day.day,
                  at: localInstant(day.day, "08:40", day.time_zone).toISOString(),
                  value: 45,
                  timing: "observation",
                  interval_min: 0,
                },
              ]
            : [],
        chartData: {
          day,
          bands: {
            resting_heart_rate: bandOf(restingBaseline),
            hrv_rmssd: bandOf(personalBaseline(history, day, "hrv_rmssd")),
          },
        },
      };
    });
}

import { personalBaseline } from "@/packages/query-tools/replay/baseline";
import {
  DEMO_PERSON_A,
  DEMO_TEN_DAYS,
  demoReplayDays,
} from "@/packages/query-tools/replay/demo-days";
import { storyPhases } from "@/packages/query-tools/replay/phases";
import { bandOf } from "@/packages/query-tools/replay/nights";

import { replayTimeline } from "./your-day-replay-events";
import { type YourDayChartData } from "./your-day-charts";

export type YourDayDemo = ReturnType<typeof replayTimeline> &
  Readonly<{ chartData: YourDayChartData }>;

export function yourDayReplayFixtures(): readonly YourDayDemo[] {
  const history = demoReplayDays(DEMO_PERSON_A);
  return history
    .filter((day) => DEMO_TEN_DAYS.includes(day.day))
    .map((day) => {
      const restingBaseline = personalBaseline(history, day, "resting_heart_rate");
      return {
        ...replayTimeline(day, storyPhases(day, { restingBaseline })),
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

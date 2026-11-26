import { personalBaseline } from "@/packages/query-tools/replay/baseline";
import {
  DEMO_PERSON_A,
  DEMO_TEN_DAYS,
  demoReplayDays,
} from "@/packages/query-tools/replay/demo-days";
import { storyPhases } from "@/packages/query-tools/replay/phases";

import { replayTimeline } from "./your-day-replay-events";

export function yourDayReplayFixtures() {
  const history = demoReplayDays(DEMO_PERSON_A);
  return history
    .filter((day) => DEMO_TEN_DAYS.includes(day.day))
    .map((day) =>
      replayTimeline(
        day,
        storyPhases(day, {
          restingBaseline: personalBaseline(history, day, "resting_heart_rate"),
        }),
      ),
    );
}

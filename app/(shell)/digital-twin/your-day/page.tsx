import { YourDayLayout } from "@/features/digital-twin/day/your-day-layout";
import { yourDayReplayFixtures } from "@/features/digital-twin/day/your-day-replay-demo";
import { YourDayViewer } from "@/features/digital-twin/day/your-day-viewer";
import { DigitalTwinFrame } from "@/features/digital-twin/digital-twin-frame";
import { lockedScreen } from "@/features/vault/page-gate";
import {
  DEMO_PERSON_A,
  DEMO_REFERENCE_DAY,
  DEMO_TIME_ZONE,
} from "@/packages/query-tools/replay/demo-days";

export default async function YourDayPage() {
  const locked = await lockedScreen();
  if (locked) return locked;
  return (
    <DigitalTwinFrame>
      <YourDayLayout
        initialDate={DEMO_REFERENCE_DAY}
        demoDays={yourDayReplayFixtures()}
        demoIdentity={{ subject_ref: DEMO_PERSON_A, time_zone: DEMO_TIME_ZONE }}
      >
        <YourDayViewer />
      </YourDayLayout>
    </DigitalTwinFrame>
  );
}

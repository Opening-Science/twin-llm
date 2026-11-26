import { YourDayLayout } from "@/features/digital-twin/day/your-day-layout";
import { YourDayViewer } from "@/features/digital-twin/day/your-day-viewer";
import { DigitalTwinFrame } from "@/features/digital-twin/digital-twin-frame";
import { lockedScreen } from "@/features/vault/page-gate";

export default async function YourDayPage() {
  const locked = await lockedScreen();
  if (locked) return locked;
  return (
    <DigitalTwinFrame>
      <YourDayLayout>
        <YourDayViewer />
      </YourDayLayout>
    </DigitalTwinFrame>
  );
}

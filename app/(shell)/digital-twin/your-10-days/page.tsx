import {
  DigitalTwinFrame,
  DigitalTwinPlaceholder,
} from "@/features/digital-twin/digital-twin-frame";
import { YOUR_TEN_DAYS } from "@/features/digital-twin/twin-page-copy";
import { lockedScreen } from "@/features/vault/page-gate";

export default async function YourTenDaysPage() {
  const locked = await lockedScreen();
  if (locked) return locked;
  return (
    <DigitalTwinFrame>
      <DigitalTwinPlaceholder title={YOUR_TEN_DAYS} />
    </DigitalTwinFrame>
  );
}

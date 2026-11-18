import { KIOSK_METADATA } from "@/features/digital-twin/kiosk/kiosk-meta";
import { KioskScreen } from "@/features/digital-twin/kiosk/kiosk-screen";
import { mockKioskDay } from "@/packages/query-tools/mock-kiosk-day";

export const metadata = KIOSK_METADATA;

/**
 * The kiosk screen. It reads no person's data, only the synthetic demo body
 * and the illustrative mock day, so it has no sign-in, no unlock and no
 * sidebar: it stands in a room in front of people who never signed in. The
 * day is built here, in the kiosk-day shape, and the screen only draws it.
 */
export default function KioskPage() {
  return <KioskScreen day={mockKioskDay("without_diabetes")} />;
}

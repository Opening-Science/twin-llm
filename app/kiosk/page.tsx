import { type Metadata } from "next";

import { KioskScreen } from "@/features/digital-twin/kiosk/kiosk-screen";

export const metadata: Metadata = {
  title: "Kiosk · TwinLLM",
  description: "The digital twin of a synthetic person, for a portrait screen.",
};

/**
 * The kiosk screen. It reads no person's data, only the synthetic demo body
 * and the illustrative day, so it has no sign-in, no unlock and no sidebar:
 * it stands in a room in front of people who never signed in.
 */
export default function KioskPage() {
  return <KioskScreen />;
}

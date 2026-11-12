import { DigitalTwinScreen } from "@/features/digital-twin/digital-twin-screen";
import { lockedScreen } from "@/features/vault/page-gate";
import { vitronicEnv } from "@/infrastructure/env";

/**
 * The twin reads Self through personal routes, so while the data is locked
 * (#142) this page shows the unlock screen like every other personal page.
 * Without it, the subjects call is refused and the picker offers only the
 * Demo body, with no word on why.
 */
export default async function DigitalTwinPage() {
  const locked = await lockedScreen();
  if (locked) return locked;
  // A boolean only: no env value leaves the server.
  return <DigitalTwinScreen bodyLoopConfigured={vitronicEnv() !== null} />;
}

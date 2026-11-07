import { DigitalTwinScreen } from "@/features/digital-twin/digital-twin-screen";
import { vitronicEnv } from "@/infrastructure/env";

export default function DigitalTwinPage() {
  // A boolean only: no env value leaves the server.
  return <DigitalTwinScreen bodyLoopConfigured={vitronicEnv() !== null} />;
}

import { type ReactNode } from "react";

import { TwinPersonProvider } from "@/features/digital-twin/twin-person-selection";

export default function DigitalTwinLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <TwinPersonProvider>{children}</TwinPersonProvider>;
}

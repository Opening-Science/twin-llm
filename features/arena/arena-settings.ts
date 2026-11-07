import "server-only";

import { serverEnv, type VitronicEnv, vitronicEnv } from "@/infrastructure/env";

import type { TwinDataMode } from "./twin-subject";

/**
 * The compare screen's settings that come from the server's environment, read
 * in one place for every page that renders the chat (`/` and `/t/<id>`). Only
 * plain values reach the client: which twin `/twin` shows, and whether
 * BodyLoop is configured, so the chat's twins skip the subjects call when it
 * is off (#499) instead of getting a 503.
 */
export type ArenaSettings = Readonly<{
  dataMode: TwinDataMode;
  bodyLoopConfigured: boolean;
}>;

export const arenaSettingsFrom = (
  dataMode: TwinDataMode,
  vitronic: VitronicEnv | null,
): ArenaSettings => ({
  dataMode,
  bodyLoopConfigured: vitronic !== null,
});

export const arenaSettings = (): ArenaSettings =>
  arenaSettingsFrom(serverEnv().DATA_MODE, vitronicEnv());

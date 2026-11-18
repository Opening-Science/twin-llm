import "server-only";

import { serverEnv, vitronicEnv } from "@/infrastructure/env";

import type { ChatSettings } from "./conversation";

/**
 * The environment the chat pages need (SERVER-SPEC 3.11), as plain values:
 * which twin `/twin` shows, and whether BodyLoop is configured so the twins
 * skip its subjects call when it is not. Never the key or the folder.
 */
export const chatSettings = (): ChatSettings => ({
  dataMode: serverEnv().DATA_MODE,
  bodyLoopConfigured: vitronicEnv() !== null,
});

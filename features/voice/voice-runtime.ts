import "server-only";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { voiceEnv } from "@/infrastructure/env";

import { createVoiceHandlers } from "./voice-handlers";

/**
 * The voice routes' handlers with the server's settings. The settings are
 * read per request, so `next build` needs none of them.
 */
export const voiceHandlers = createVoiceHandlers({
  resolveActorId,
  config: () => {
    const env = voiceEnv();
    return {
      baseUrl: env.sidecarUrl,
      timeoutMs: env.timeoutMs,
      logError: (message) => console.error(message),
    };
  },
});

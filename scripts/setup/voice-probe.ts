import { existsSync } from "node:fs";
import { join } from "node:path";

import { isLoopbackUrl } from "../../infrastructure/loopback";
import { speechHealthSchema } from "../../infrastructure/speech/contract";

/**
 * Voice for `bun run doctor` (docs/voice.md): whether the engines are set up
 * (`voice.json` from `voice:setup`), whether `VOICE_SIDECAR_URL` is set and on
 * this machine, and whether the sidecar answers its health. Read-only, and it
 * says nothing when voice was never asked for.
 */

export type VoiceProbe = Readonly<{
  /** `voice.json` exists in the voice folder. */
  setUp: boolean;
  /** The URL as set, or null. */
  url: string | null;
  /** The health answer's engines, or null when it did not answer. */
  health: Readonly<{ stt: string; tts: string }> | null;
}>;

export const DEFAULT_VOICE_HOME = ".local/share/twinllm-voice";

export const probeVoice = async (
  env: Readonly<Record<string, string | undefined>>,
  home: string,
  doFetch: typeof fetch = fetch,
): Promise<VoiceProbe> => {
  const folder = env.VOICE_HOME ?? join(home, DEFAULT_VOICE_HOME);
  const url = env.VOICE_SIDECAR_URL?.trim() || null;
  const health =
    url === null || !isLoopbackUrl(url)
      ? null
      : await doFetch(`${url.replace(/\/+$/, "")}/health`, {
          signal: AbortSignal.timeout(3000),
          redirect: "error",
        })
          .then(async (response) =>
            response.ok ? speechHealthSchema.safeParse(await response.json()) : null,
          )
          .then((parsed) =>
            parsed?.success === true
              ? {
                  stt: `${parsed.data.stt.engine} ${parsed.data.stt.model}`,
                  tts: `${parsed.data.tts.engine} ${parsed.data.tts.voices.en}, ${parsed.data.tts.voices.de}`,
                }
              : null,
          )
          .catch(() => null);
  return { setUp: existsSync(join(folder, "voice.json")), url, health };
};

/** The doctor's lines; none when voice is neither set up nor asked for. Pure. */
export const voiceSection = (probe: VoiceProbe): readonly string[] => {
  if (!probe.setUp && probe.url === null) return [];
  const setup = probe.setUp
    ? "  [ok]      Engines set up (voice.json)"
    : "  [missing] Engines not set up: bun run voice:setup";
  const url =
    probe.url === null
      ? "  [off]     VOICE_SIDECAR_URL not set: voice stays off in the app"
      : !isLoopbackUrl(probe.url)
        ? "  [no]      VOICE_SIDECAR_URL is not on this machine; the app will not start"
        : probe.health === null
          ? "  [no]      The sidecar does not answer: bun run voice:serve"
          : `  [ok]      Sidecar answers: ${probe.health.stt}; ${probe.health.tts}`;
  return ["Voice (docs/voice.md)", setup, url, ""];
};

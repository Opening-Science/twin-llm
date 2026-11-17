import "server-only";

import { isLoopbackUrl } from "@/infrastructure/loopback";

import {
  SPEAK_ELAPSED_HEADER,
  type SpeakRequest,
  type SpeechFailure,
  type SpeechFailureCode,
  type SpeechHealth,
  type SpeechLanguage,
  speechHealthSchema,
  type Transcript,
  transcriptSchema,
} from "./contract";
import { speechWavProblem, wavInfo } from "./wav";

/**
 * Talks to the speech sidecar (`contract.ts`). The address must be on this
 * machine: a spoken question is the person's voice, so a URL elsewhere is
 * refused here as well as at startup. The sidecar's error text and the fetch
 * exception never leave this module; callers get a code.
 */

export type SpeechConfig = Readonly<{
  /** The sidecar's root, such as `http://127.0.0.1:8095`; null when voice is off. */
  baseUrl: string | null;
  timeoutMs: number;
  fetch?: typeof fetch;
  logError?: (message: string) => void;
}>;

export type TranscribeResult = (Readonly<{ ok: true }> & Transcript) | SpeechFailure;

export type SpeakResult =
  Readonly<{ ok: true; wav: Uint8Array; elapsedMs: number }> | SpeechFailure;

const fail = (code: SpeechFailureCode): SpeechFailure => ({ ok: false, code });

type Ready = Readonly<{ root: string; doFetch: typeof fetch }>;

const ready = (config: SpeechConfig): Ready | SpeechFailure => {
  if (config.baseUrl === null) return fail("SPEECH_OFF");
  if (!isLoopbackUrl(config.baseUrl)) return fail("SPEECH_NOT_LOCAL");
  return { root: config.baseUrl.replace(/\/+$/, ""), doFetch: config.fetch ?? fetch };
};

const isFailure = (value: Ready | SpeechFailure): value is SpeechFailure => "ok" in value;

/** One call with the config's time limit; a thrown fetch becomes a code. */
const call = async (
  config: SpeechConfig,
  run: (signal: AbortSignal) => Promise<Response>,
  what: string,
): Promise<Response | SpeechFailure> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    const timedOut = controller.signal.aborted;
    config.logError?.(
      `speech sidecar ${what}: ${timedOut ? "timed out" : error instanceof Error ? error.message : String(error)}`,
    );
    return fail(timedOut ? "SPEECH_TIMEOUT" : "SPEECH_UNREACHABLE");
  } finally {
    clearTimeout(timer);
  }
};

const failedResponse = async (
  config: SpeechConfig,
  response: Response,
  what: string,
): Promise<SpeechFailure> => {
  const body = await response.text().catch(() => "");
  config.logError?.(
    `speech sidecar ${what}: HTTP ${response.status} ${body.slice(0, 500)}`,
  );
  return fail(response.status === 400 ? "SPEECH_BAD_AUDIO" : "SPEECH_FAILED");
};

/** The sidecar's health, or null when it is off, elsewhere, down or answers oddly. */
export const speechHealth = async (
  config: SpeechConfig,
): Promise<SpeechHealth | null> => {
  const target = ready(config);
  if (isFailure(target)) return null;
  const response = await call(
    { ...config, timeoutMs: Math.min(config.timeoutMs, 3000) },
    (signal) => target.doFetch(`${target.root}/health`, { signal }),
    "health",
  );
  if (!(response instanceof Response) || !response.ok) return null;
  const parsed = speechHealthSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data : null;
};

/** A spoken question to text. The WAV is checked before it is sent. */
export const transcribeSpeech = async (
  config: SpeechConfig,
  wav: Uint8Array,
  language: SpeechLanguage,
): Promise<TranscribeResult> => {
  const target = ready(config);
  if (isFailure(target)) return target;
  if (speechWavProblem(wav) !== null) return fail("SPEECH_BAD_AUDIO");
  const response = await call(
    config,
    (signal) =>
      target.doFetch(`${target.root}/v1/transcribe?language=${language}`, {
        method: "POST",
        headers: { "content-type": "audio/wav" },
        body: new Blob([wav.slice()], { type: "audio/wav" }),
        signal,
      }),
    "transcribe",
  );
  if (!(response instanceof Response)) return response;
  if (!response.ok) return failedResponse(config, response, "transcribe");
  const parsed = transcriptSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || parsed.data.language !== language) {
    config.logError?.("speech sidecar transcribe: answer did not match the contract");
    return fail("SPEECH_FAILED");
  }
  const text = parsed.data.text.trim();
  return text === "" ? fail("SPEECH_NOTHING_HEARD") : { ok: true, ...parsed.data, text };
};

/** An answer to speech, as a WAV file. */
export const speakText = async (
  config: SpeechConfig,
  request: SpeakRequest,
): Promise<SpeakResult> => {
  const target = ready(config);
  if (isFailure(target)) return target;
  const response = await call(
    config,
    (signal) =>
      target.doFetch(`${target.root}/v1/speak`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal,
      }),
    "speak",
  );
  if (!(response instanceof Response)) return response;
  if (!response.ok) return failedResponse(config, response, "speak");
  const wav = new Uint8Array(await response.arrayBuffer());
  if (wavInfo(wav) === null) {
    config.logError?.("speech sidecar speak: answer was not a WAV file");
    return fail("SPEECH_FAILED");
  }
  const elapsed = Number(response.headers.get(SPEAK_ELAPSED_HEADER));
  return {
    ok: true,
    wav,
    elapsedMs: Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : 0,
  };
};

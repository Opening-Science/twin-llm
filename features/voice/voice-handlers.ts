import "server-only";

import {
  isSpeechLanguage,
  speakRequestSchema,
  SPEECH_FAILURE_MESSAGES,
  type SpeechFailureCode,
  type SpeechLanguage,
} from "@/infrastructure/speech/contract";
import {
  speakText,
  type SpeechConfig,
  speechHealth,
  transcribeSpeech,
} from "@/infrastructure/speech/sidecar-client";
import { MAX_SPEECH_WAV_BYTES } from "@/infrastructure/speech/wav";

/**
 * The browser's way to the speech sidecar (docs/voice.md): whether voice is
 * on, a recording to text, and text to speech. The audio passes through and
 * is never stored or logged; a failure is one plain sentence and its code.
 * Signed-in only, like the chat the text goes to.
 */

export type VoiceStatus = Readonly<{
  on: boolean;
  languages: readonly SpeechLanguage[];
}>;

export type Transcribed = Readonly<{
  text: string;
  language: SpeechLanguage;
  /** Length of the recording, the sidecar's time, and the time this request took. */
  timings: Readonly<{ audioMs: number; sttMs: number; totalMs: number }>;
}>;

export type VoiceFailureBody = Readonly<{ code: SpeechFailureCode; error: string }>;

export type VoiceHandlerDeps = Readonly<{
  resolveActorId: () => Promise<string | null>;
  config: () => SpeechConfig;
  now?: () => number;
}>;

const STATUS_BY_CODE: Readonly<Record<SpeechFailureCode, number>> = {
  SPEECH_OFF: 503,
  SPEECH_NOT_LOCAL: 503,
  SPEECH_UNREACHABLE: 503,
  SPEECH_TIMEOUT: 504,
  SPEECH_FAILED: 502,
  SPEECH_BAD_AUDIO: 400,
  SPEECH_NOTHING_HEARD: 422,
};

export const voiceFailure = (code: SpeechFailureCode): Response =>
  Response.json(
    { code, error: SPEECH_FAILURE_MESSAGES[code] } satisfies VoiceFailureBody,
    { status: STATUS_BY_CODE[code] },
  );

const UNAUTHORISED = (): Response =>
  Response.json({ error: "Sign in to use voice." }, { status: 401 });

const NO_STORE = { "cache-control": "no-store" } as const;

export const createVoiceHandlers = (deps: VoiceHandlerDeps) => {
  const now = deps.now ?? (() => performance.now());

  const status = async (): Promise<Response> => {
    if ((await deps.resolveActorId()) === null) return UNAUTHORISED();
    const health = await speechHealth(deps.config());
    return Response.json(
      {
        on: health !== null,
        languages: health === null ? [] : ["en", "de"],
      } satisfies VoiceStatus,
      { headers: NO_STORE },
    );
  };

  const transcribe = async (request: Request): Promise<Response> => {
    const started = now();
    if ((await deps.resolveActorId()) === null) return UNAUTHORISED();
    const language = new URL(request.url).searchParams.get("language");
    if (!isSpeechLanguage(language)) return voiceFailure("SPEECH_BAD_AUDIO");
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_SPEECH_WAV_BYTES) return voiceFailure("SPEECH_BAD_AUDIO");
    const wav = new Uint8Array(await request.arrayBuffer());
    const result = await transcribeSpeech(deps.config(), wav, language);
    if (!result.ok) return voiceFailure(result.code);
    return Response.json(
      {
        text: result.text,
        language: result.language,
        timings: {
          audioMs: result.audioMs,
          sttMs: result.elapsedMs,
          totalMs: Math.round(now() - started),
        },
      } satisfies Transcribed,
      { headers: NO_STORE },
    );
  };

  const speak = async (request: Request): Promise<Response> => {
    if ((await deps.resolveActorId()) === null) return UNAUTHORISED();
    const parsed = speakRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: "There was nothing to read aloud." },
        { status: 400 },
      );
    }
    const result = await speakText(deps.config(), parsed.data);
    if (!result.ok) return voiceFailure(result.code);
    return new Response(result.wav.slice(), {
      headers: {
        "content-type": "audio/wav",
        "x-speech-elapsed-ms": String(result.elapsedMs),
        ...NO_STORE,
      },
    });
  };

  return { status, transcribe, speak };
};

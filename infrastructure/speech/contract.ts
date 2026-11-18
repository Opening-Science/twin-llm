import { z } from "zod";

/**
 * The speech sidecar's contract (docs/voice.md): a separate process on this
 * machine that turns a spoken question into text and an answer into speech.
 * Two languages, English and German. The app talks to it over HTTP and never
 * imports it, so the engines behind it can change without touching the app.
 *
 * - `GET /health`: which engines and voices are loaded.
 * - `POST /v1/transcribe?language=en|de`: a 16 kHz mono 16-bit WAV body
 *   (`wav.ts`) in, `{ text, language, audioMs, elapsedMs }` out.
 * - `POST /v1/speak`: `{ text, language }` in, `audio/wav` out, with the time
 *   it took in the `x-speech-elapsed-ms` header.
 *
 * Errors are `{ error: { message, type } }` with a plain message; the cause
 * stays in the sidecar's own log. Nothing is stored on either side.
 */

export const SPEECH_LANGUAGES = ["en", "de"] as const;

export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];

export const isSpeechLanguage = (value: unknown): value is SpeechLanguage =>
  typeof value === "string" && (SPEECH_LANGUAGES as readonly string[]).includes(value);

export const SPEECH_LANGUAGE_NAMES: Readonly<Record<SpeechLanguage, string>> = {
  en: "English",
  de: "Deutsch",
};

/** The most text one `speak` call reads; a longer answer is cut at a sentence. */
export const MAX_SPEAK_CHARS = 2000;

export const SPEAK_ELAPSED_HEADER = "x-speech-elapsed-ms";

export const speechHealthSchema = z.object({
  status: z.literal("ok"),
  stt: z.object({ engine: z.string(), model: z.string() }),
  tts: z.object({
    engine: z.string(),
    voices: z.object({ en: z.string(), de: z.string() }),
  }),
});

export type SpeechHealth = z.infer<typeof speechHealthSchema>;

export const transcriptSchema = z.object({
  text: z.string(),
  language: z.enum(SPEECH_LANGUAGES),
  /** Length of the audio heard. */
  audioMs: z.number().int().nonnegative(),
  /** Time the sidecar spent on it. */
  elapsedMs: z.number().int().nonnegative(),
});

export type Transcript = z.infer<typeof transcriptSchema>;

export const speakRequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_SPEAK_CHARS),
  language: z.enum(SPEECH_LANGUAGES),
});

export type SpeakRequest = z.infer<typeof speakRequestSchema>;

export const speechErrorSchema = z.object({
  error: z.object({ message: z.string(), type: z.string() }),
});

/** What can go wrong between the app and the sidecar, as codes the UI words. */
export const SPEECH_FAILURE_CODES = [
  "SPEECH_OFF",
  "SPEECH_NOT_LOCAL",
  "SPEECH_UNREACHABLE",
  "SPEECH_TIMEOUT",
  "SPEECH_FAILED",
  "SPEECH_BAD_AUDIO",
  "SPEECH_NOTHING_HEARD",
] as const;

export type SpeechFailureCode = (typeof SPEECH_FAILURE_CODES)[number];

export type SpeechFailure = Readonly<{ ok: false; code: SpeechFailureCode }>;

/** One plain sentence per code, safe to show; never the sidecar's own text. */
export const SPEECH_FAILURE_MESSAGES: Readonly<Record<SpeechFailureCode, string>> = {
  SPEECH_OFF: "Voice is not set up on this machine.",
  SPEECH_NOT_LOCAL: "Voice only runs on this machine, and its address points elsewhere.",
  SPEECH_UNREACHABLE: "The voice service is not running. Start it and try again.",
  SPEECH_TIMEOUT: "The voice service took too long. Try a shorter question.",
  SPEECH_FAILED: "The voice service could not handle that. Try again.",
  SPEECH_BAD_AUDIO: "That recording could not be read. Try again.",
  SPEECH_NOTHING_HEARD: "Nothing was heard. Hold the button while you speak.",
};

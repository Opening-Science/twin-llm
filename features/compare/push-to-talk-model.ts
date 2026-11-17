import { z } from "zod";

import {
  SPEECH_FAILURE_CODES,
  SPEECH_FAILURE_MESSAGES,
  SPEECH_LANGUAGES,
  type SpeechFailureCode,
  type SpeechLanguage,
} from "@/infrastructure/speech/contract";
import { formatElapsed } from "@/infrastructure/format-measure";
import type { MicrophoneProblem } from "@/infrastructure/speech/recorder";

/**
 * The words and the one request behind push to talk (`push-to-talk.tsx`),
 * apart from the component so tests reach them without a microphone.
 */

export type PushToTalkPhase = "idle" | "listening" | "writing";

const heardSchema = z.object({
  text: z.string().min(1),
  language: z.enum(SPEECH_LANGUAGES),
  timings: z.object({
    audioMs: z.number(),
    sttMs: z.number(),
    totalMs: z.number(),
  }),
});

/** What was heard, and how long each part took (#615). */
export type VoiceHeard = z.infer<typeof heardSchema>;

export const MICROPHONE_LINES: Readonly<Record<MicrophoneProblem, string>> = {
  BLOCKED: "The microphone is blocked. Allow it for this page to speak.",
  MISSING: "No microphone was found.",
};

const LANGUAGE_WORDS: Readonly<Record<SpeechLanguage, string>> = {
  en: "English",
  de: "German",
};

export const pushToTalkLabel = (
  phase: PushToTalkPhase,
  language: SpeechLanguage,
): string => {
  if (phase === "listening") return "Listening… let go to send";
  if (phase === "writing") return "Writing down what you said…";
  return `Hold to speak in ${LANGUAGE_WORDS[language]}`;
};

/** The hint line after a spoken question: what took how long (#615). */
export const heardLine = (heard: VoiceHeard): string =>
  `Heard ${formatElapsed(heard.timings.audioMs)} of ${LANGUAGE_WORDS[heard.language]}, written down in ${formatElapsed(heard.timings.sttMs)} (${formatElapsed(heard.timings.totalMs)} in all).`;

const VOICE_LANGUAGE_KEY = "twinllm.voice.language";

/** German when the browser's first language is German, English otherwise. */
export const defaultVoiceLanguage = (languages: readonly string[]): SpeechLanguage =>
  languages[0]?.toLowerCase().startsWith("de") === true ? "de" : "en";

export const storedVoiceLanguage = (): SpeechLanguage => {
  try {
    const stored = window.localStorage.getItem(VOICE_LANGUAGE_KEY);
    if ((SPEECH_LANGUAGES as readonly string[]).includes(stored ?? "")) {
      return stored as SpeechLanguage;
    }
  } catch {
    // Storage can be off; the browser's language decides then.
  }
  return defaultVoiceLanguage(navigator.languages);
};

export const storeVoiceLanguage = (language: SpeechLanguage): void => {
  try {
    window.localStorage.setItem(VOICE_LANGUAGE_KEY, language);
  } catch {
    // Not remembered; the choice still holds for this page.
  }
};

const isFailureCode = (value: unknown): value is SpeechFailureCode =>
  typeof value === "string" &&
  (SPEECH_FAILURE_CODES as readonly string[]).includes(value);

export type TranscribeOutcome =
  Readonly<{ ok: true; heard: VoiceHeard }> | Readonly<{ ok: false; message: string }>;

/** The route's answer in words; anything unexpected is the generic failure. */
export const transcribeOutcome = (status: number, body: unknown): TranscribeOutcome => {
  const heard = heardSchema.safeParse(body);
  if (status === 200 && heard.success) return { ok: true, heard: heard.data };
  const code =
    typeof body === "object" && body !== null && "code" in body ? body.code : null;
  return {
    ok: false,
    message: SPEECH_FAILURE_MESSAGES[isFailureCode(code) ? code : "SPEECH_FAILED"],
  };
};

export const transcribeRecording = async (
  wav: Uint8Array,
  language: SpeechLanguage,
): Promise<TranscribeOutcome> => {
  try {
    const response = await fetch(`/api/voice/transcribe?language=${language}`, {
      method: "POST",
      headers: { "content-type": "audio/wav" },
      body: new Blob([wav.slice()], { type: "audio/wav" }),
    });
    return transcribeOutcome(response.status, await response.json().catch(() => null));
  } catch {
    return transcribeOutcome(0, null);
  }
};

import type { SpeechLanguage } from "./contract";

/**
 * Reading aloud with the browser's own voices, the Web Speech API's
 * `speechSynthesis` (docs/voice.md). Nothing is downloaded for it. Only a
 * voice on this machine is used: some browsers also list voices that speak
 * through their maker's servers, and the answer must never go there.
 */

export const SPEECH_LOCALES: Readonly<Record<SpeechLanguage, string>> = {
  en: "en-GB",
  de: "de-DE",
};

export type VoiceLike = Readonly<{ lang: string; localService: boolean }>;

/** `en_GB` and `en-gb` are both `en-GB`. */
const locale = (lang: string): string => lang.replace("_", "-").toLowerCase();

/**
 * A voice on this machine for the language: the exact locale (en-GB, de-DE)
 * first, then any of the language; null when there is none. Pure.
 */
export const localVoice = <V extends VoiceLike>(
  voices: readonly V[],
  language: SpeechLanguage,
): V | null => {
  const local = voices.filter((voice) => voice.localService);
  const exact = SPEECH_LOCALES[language].toLowerCase();
  return (
    local.find((voice) => locale(voice.lang) === exact) ??
    local.find((voice) => locale(voice.lang).split("-")[0] === language) ??
    null
  );
};

export type Synth = Readonly<{
  speak: (utterance: SpeechSynthesisUtterance) => void;
  cancel: () => void;
}>;

/**
 * The browser's voices. Some browsers fill the list a moment after the page
 * loads, so an empty list waits briefly for `voiceschanged`.
 */
export const browserVoices = (
  synth: SpeechSynthesis,
  waitMs = 1500,
): Promise<readonly SpeechSynthesisVoice[]> => {
  const now = synth.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      synth.removeEventListener("voiceschanged", done);
      resolve(synth.getVoices());
    };
    const timer = setTimeout(done, waitMs);
    synth.addEventListener("voiceschanged", done);
  });
};

/**
 * Queues each piece as one utterance in the language's locale and voice, and
 * settles when the last has ended. `onFirstWords` runs once, when the browser
 * starts saying the first piece (its `start` event), not when it is queued.
 * Stopping cancels the browser's speech and settles quietly; a failed
 * utterance cancels the rest and rejects.
 */
export const sayAll = (
  synth: Synth,
  pieces: readonly string[],
  voice: SpeechSynthesisVoice,
  language: SpeechLanguage,
  signal: AbortSignal,
  onFirstWords: () => void = () => undefined,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      synth.cancel();
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const settle = (error: Error | null) => {
      signal.removeEventListener("abort", onAbort);
      if (error === null) resolve();
      else reject(error);
    };
    pieces.forEach((piece, index) => {
      const utterance = new SpeechSynthesisUtterance(piece);
      utterance.lang = SPEECH_LOCALES[language];
      utterance.voice = voice;
      utterance.addEventListener("error", (event) => {
        if (signal.aborted) return;
        synth.cancel();
        settle(new Error(event.error));
      });
      if (index === 0) {
        utterance.addEventListener("start", () => {
          if (!signal.aborted) onFirstWords();
        });
      }
      if (index === pieces.length - 1) {
        utterance.addEventListener("end", () => settle(null));
      }
      synth.speak(utterance);
    });
  });

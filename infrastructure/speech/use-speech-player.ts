"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { browserVoices, localVoice, sayAll } from "./browser-speech";
import type { SpeechLanguage } from "./contract";
import { spokenChunks, spokenText } from "./spoken-text";

/**
 * Reads an answer aloud with the browser's own voices (docs/voice.md), only
 * ever a voice on this machine, so the answer goes nowhere. The answer is cut
 * into pieces of whole sentences and queued. One answer at a time: starting
 * another, or `stop`, cancels the one being read.
 */

export type SpeechTimings = Readonly<{
  /** From the press (or the answer's end) to the first sound. */
  firstSoundMs: number;
}>;

export type SpeechPlayer = Readonly<{
  /** The id of the answer being read, or null. */
  speakingId: string | null;
  /** The answer whose reading failed last, with a plain sentence. */
  problem: Readonly<{ id: string; message: string }> | null;
  lastTimings: SpeechTimings | null;
  speak: (id: string, text: string, language: SpeechLanguage) => void;
  stop: () => void;
}>;

export const READ_ALOUD_FAILED = "The answer could not be read aloud. Try again.";

const LANGUAGE_WORDS: Readonly<Record<SpeechLanguage, string>> = {
  en: "English",
  de: "German",
};

/** When the browser has no voice of that language on this machine. */
export const noLocalVoice = (language: SpeechLanguage): string =>
  `This browser has no ${LANGUAGE_WORDS[language]} voice on this machine, so nothing is read aloud.`;

export const useSpeechPlayer = (): SpeechPlayer => {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [problem, setProblem] = useState<SpeechPlayer["problem"]>(null);
  const [lastTimings, setLastTimings] = useState<SpeechTimings | null>(null);
  const current = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    current.current?.abort();
    current.current = null;
    setSpeakingId(null);
  }, []);

  useEffect(() => stop, [stop]);

  const speak = useCallback((id: string, text: string, language: SpeechLanguage) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    const chunks = spokenChunks(spokenText(text, language));
    if (chunks.length === 0) {
      setSpeakingId(null);
      return;
    }
    if (!("speechSynthesis" in window)) {
      setSpeakingId(null);
      setProblem({ id, message: noLocalVoice(language) });
      return;
    }
    const synth = window.speechSynthesis;
    setSpeakingId(id);
    setProblem(null);
    const started = performance.now();
    const run = async (): Promise<string | null> => {
      const voice = localVoice(await browserVoices(synth), language);
      if (controller.signal.aborted) return null;
      if (voice === null) return noLocalVoice(language);
      const saying = sayAll(synth, chunks, voice, language, controller.signal);
      setLastTimings({ firstSoundMs: Math.round(performance.now() - started) });
      await saying;
      return null;
    };
    void run()
      .catch(() => READ_ALOUD_FAILED)
      .then((message) => {
        if (message !== null && !controller.signal.aborted) setProblem({ id, message });
      })
      .finally(() => {
        if (current.current === controller) {
          current.current = null;
          setSpeakingId(null);
        }
      });
  }, []);

  return useMemo(
    () => ({ speakingId, problem, lastTimings, speak, stop }),
    [speakingId, problem, lastTimings, speak, stop],
  );
};

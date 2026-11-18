"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SpeechLanguage } from "./contract";
import { spokenChunks, spokenText } from "./spoken-text";

/**
 * Reads an answer aloud through the app's `/api/voice/speak` (docs/voice.md).
 * The answer is cut into pieces of whole sentences; the first plays as soon
 * as it is made and the next is made while it plays. One answer at a time:
 * starting another, or `stop`, ends the one playing. Nothing is kept once it
 * has played.
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

const fetchSpeech = async (
  text: string,
  language: SpeechLanguage,
  signal: AbortSignal,
): Promise<Blob> => {
  const response = await fetch("/api/voice/speak", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, language }),
    signal,
  });
  if (!response.ok) throw new Error(`speak ${response.status}`);
  return response.blob();
};

const play = (blob: Blob, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const done = () => {
      audio.pause();
      URL.revokeObjectURL(url);
    };
    audio.addEventListener("ended", () => {
      done();
      resolve();
    });
    audio.addEventListener("error", () => {
      done();
      reject(new Error("audio"));
    });
    signal.addEventListener("abort", () => {
      done();
      resolve();
    });
    void audio.play().catch((error: unknown) => {
      done();
      reject(error instanceof Error ? error : new Error("audio"));
    });
  });

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
    setSpeakingId(id);
    setProblem(null);
    const started = performance.now();
    const run = async () => {
      const fetchQuiet = (text: string) => {
        const pendingSpeech = fetchSpeech(text, language, controller.signal);
        // Awaited below; this keeps a piece fetched ahead from failing unheard.
        void pendingSpeech.catch(() => undefined);
        return pendingSpeech;
      };
      let next = fetchQuiet(chunks[0] ?? "");
      for (const [index] of chunks.entries()) {
        const blob = await next;
        if (controller.signal.aborted) return;
        const following = chunks[index + 1];
        if (following !== undefined) {
          next = fetchQuiet(following);
        }
        if (index === 0) {
          setLastTimings({ firstSoundMs: Math.round(performance.now() - started) });
        }
        await play(blob, controller.signal);
      }
    };
    void run()
      .catch(() => {
        if (!controller.signal.aborted) setProblem({ id, message: READ_ALOUD_FAILED });
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

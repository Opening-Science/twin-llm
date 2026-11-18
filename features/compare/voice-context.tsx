"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { SpeechLanguage } from "@/infrastructure/speech/contract";
import {
  type SpeechPlayer,
  useSpeechPlayer,
} from "@/infrastructure/speech/use-speech-player";

import { storedVoiceLanguage, storeVoiceLanguage } from "./push-to-talk-model";

/**
 * Voice on the chat screen (#616): whether the speech sidecar is set up, the
 * language picked for it, and the one player that reads answers aloud. Asked
 * once per screen; while it is off nothing about voice is drawn.
 */

export type Voice = Readonly<{
  on: boolean;
  language: SpeechLanguage;
  setLanguage: (next: SpeechLanguage) => void;
  player: SpeechPlayer;
}>;

const OFF_PLAYER: SpeechPlayer = {
  speakingId: null,
  problem: null,
  lastTimings: null,
  speak: () => undefined,
  stop: () => undefined,
};

const VoiceContext = createContext<Voice>({
  on: false,
  language: "en",
  setLanguage: () => undefined,
  player: OFF_PLAYER,
});

export const useVoice = (): Voice => useContext(VoiceContext);

const readVoiceOn = async (): Promise<boolean> => {
  try {
    const response = await fetch("/api/voice/status");
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && "on" in body && body.on === true;
  } catch {
    return false;
  }
};

export const VoiceProvider = ({ children }: Readonly<{ children: ReactNode }>) => {
  const [on, setOn] = useState(false);
  const [language, setLanguageState] = useState<SpeechLanguage>("en");
  const player = useSpeechPlayer();

  useEffect(() => {
    let live = true;
    setLanguageState(storedVoiceLanguage());
    void readVoiceOn().then((answer) => {
      if (live) setOn(answer);
    });
    return () => {
      live = false;
    };
  }, []);

  const value = useMemo<Voice>(
    () => ({
      on,
      language,
      setLanguage: (next) => {
        storeVoiceLanguage(next);
        setLanguageState(next);
      },
      player,
    }),
    [on, language, player],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
};

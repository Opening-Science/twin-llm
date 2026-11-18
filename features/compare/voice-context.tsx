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

import { storedVoiceLanguage, storeVoiceLanguage } from "./push-to-talk-model";

/**
 * Voice on the chat screen (#616): whether the speech sidecar is set up and
 * the language picked for it. Asked once per screen; while it is off nothing
 * about voice is drawn.
 */

export type Voice = Readonly<{
  on: boolean;
  language: SpeechLanguage;
  setLanguage: (next: SpeechLanguage) => void;
}>;

const VoiceContext = createContext<Voice>({
  on: false,
  language: "en",
  setLanguage: () => undefined,
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
    }),
    [on, language],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
};

"use client";

import { useEffect, useRef } from "react";

import type { TurnState } from "./conversation";
import { spokenAnswer, type SpokenTurn } from "./spoken-turn";
import { useVoice } from "./voice-context";

/**
 * Reads the answer to a spoken question aloud once it is finished (#616), in
 * the language it was asked in, once per spoken turn. Draws nothing.
 */
export const SpokenTurnReader = ({
  turns,
  spoken,
}: Readonly<{ turns: readonly TurnState[]; spoken: SpokenTurn | null }>) => {
  const { on, player } = useVoice();
  const readFor = useRef<number | null>(null);
  const found = spokenAnswer(turns, spoken);
  const foundId = found?.id ?? null;
  const foundText = found?.text ?? "";
  const speak = player.speak;

  useEffect(() => {
    if (!on || spoken === null || foundId === null) return;
    if (readFor.current === spoken.index) return;
    readFor.current = spoken.index;
    speak(foundId, foundText, spoken.language);
  }, [on, spoken, foundId, foundText, speak]);

  return null;
};

"use client";

import { useEffect, useRef } from "react";

import type { TurnState } from "./conversation";
import { type SpokenAnswer, spokenAnswer, type SpokenTurn } from "./spoken-turn";
import { useVoice } from "./voice-context";

/**
 * Reads the answer to a spoken question aloud once it is finished (#616), in
 * the language it was asked in, once per spoken turn, and tells the screen
 * (`onAnswer`) so the twin can turn. Draws nothing.
 */
export const SpokenTurnReader = ({
  turns,
  spoken,
  onAnswer,
}: Readonly<{
  turns: readonly TurnState[];
  spoken: SpokenTurn | null;
  onAnswer?: (answer: SpokenAnswer) => void;
}>) => {
  const { on, player } = useVoice();
  const readFor = useRef<number | null>(null);
  const found = spokenAnswer(turns, spoken);
  const answered = useRef(onAnswer);
  useEffect(() => {
    answered.current = onAnswer;
  }, [onAnswer]);
  const speak = player.speak;

  // `found` is new each render; the turn's index keeps this to once.
  useEffect(() => {
    if (!on || spoken === null || found === null) return;
    if (readFor.current === spoken.index) return;
    readFor.current = spoken.index;
    speak(found.id, found.text, spoken.language);
    answered.current?.(found);
  }, [on, spoken, found, speak]);

  return null;
};

"use client";

import { useEffect, useState } from "react";

import { Button } from "@/infrastructure/ui-kit/button";

import type { SuggestedQuestion, SuggestedQuestions } from "./suggested-questions";

/**
 * Suggested first questions for an empty thread, new or saved. They are
 * fetched while `startersShown` holds and go with the first turn; a chip
 * writes its short question into the prompt and sends nothing; the grounded
 * prompt goes to the model only if the question is sent unchanged (#480).
 * A failed fetch shows no chips: the chat works without them.
 */

const fetchSuggestions = async (
  subjectRef: string | undefined,
): Promise<SuggestedQuestions | null> => {
  try {
    const response = await fetch(
      subjectRef === undefined
        ? "/api/chat/suggestions"
        : `/api/chat/suggestions?subject=${encodeURIComponent(subjectRef)}`,
    );
    if (!response.ok) return null;
    return (await response.json()) as SuggestedQuestions;
  } catch {
    return null;
  }
};

export const useSuggestedQuestions = (
  enabled: boolean,
  subjectRef?: string,
): SuggestedQuestions | null => {
  const [suggestions, setSuggestions] = useState<SuggestedQuestions | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void fetchSuggestions(subjectRef).then((fresh) => {
      if (current) setSuggestions(fresh);
    });
    return () => {
      current = false;
    };
  }, [enabled, subjectRef]);
  return enabled ? suggestions : null;
};

export const SuggestionChips = ({
  suggestions,
  onPick,
}: Readonly<{
  suggestions: SuggestedQuestions;
  onPick: (question: SuggestedQuestion) => void;
}>) =>
  suggestions.questions.length === 0 ? null : (
    <section
      aria-label="Suggested questions"
      className="page-column mb-2 flex flex-col items-center gap-1.5"
    >
      <p className="text-muted-foreground text-xs">{suggestions.heading}</p>
      <ul className="flex flex-wrap justify-center gap-1.5">
        {suggestions.questions.map((question) => (
          <li key={question.prompt}>
            <Button
              variant="pill"
              size="sm"
              onClick={() => onPick(question)}
              className="bg-background text-muted-foreground hover:text-foreground font-normal"
            >
              {question.label}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );

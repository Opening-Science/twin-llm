"use client";

import { useEffect, useState } from "react";

import { Button } from "@/infrastructure/ui-kit/button";

import type { SuggestedQuestion, SuggestedQuestions } from "./suggested-questions";

/**
 * Suggested first questions for an empty chat. They are fetched once for a
 * new thread; a chip writes its question into the prompt and sends nothing.
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
      className="mx-auto mb-2 flex max-w-5xl flex-col items-center gap-1.5"
    >
      <p className="text-muted-foreground text-xs">{suggestions.heading}</p>
      <ul className="flex flex-wrap justify-center gap-1.5">
        {suggestions.questions.map((question) => (
          <li key={question.prompt}>
            <Button
              variant="pill"
              size="sm"
              title={question.prompt === question.label ? undefined : question.prompt}
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

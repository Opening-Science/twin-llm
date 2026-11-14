"use client";

import { useEffect, useState } from "react";

import {
  parseSuggestions,
  type SuggestedQuestion,
  type Suggestions,
} from "./suggestion-send";

/**
 * Up to five suggested questions over the prompt box of an empty thread
 * (SPEC 7.6), read from this app's own route. A chip writes its short
 * question into the box and nothing is sent. A failed read shows nothing.
 */

const useSuggestions = (subjectRef: string | undefined): Suggestions | null => {
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  useEffect(() => {
    let cancelled = false;
    const query =
      subjectRef === undefined ? "" : `?subject=${encodeURIComponent(subjectRef)}`;
    void fetch(`/api/chat/suggestions${query}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (!cancelled) setSuggestions(parseSuggestions(value));
      })
      .catch(() => {
        if (!cancelled) setSuggestions(null);
      });
    return () => {
      cancelled = true;
    };
  }, [subjectRef]);
  return suggestions;
};

export const SuggestionChips = ({
  subjectRef,
  onPick,
}: Readonly<{
  subjectRef?: string;
  onPick: (question: SuggestedQuestion) => void;
}>) => {
  const suggestions = useSuggestions(subjectRef);
  if (suggestions === null || suggestions.questions.length === 0) return null;
  return (
    <div className="mb-2 flex flex-col gap-1.5">
      {suggestions.heading === "" ? null : (
        <p id="suggested-questions-heading" className="text-eyebrow px-1">
          {suggestions.heading}
        </p>
      )}
      <div
        role="group"
        aria-label="Suggested questions"
        className="flex flex-wrap gap-1.5"
      >
        {suggestions.questions.map((question) => (
          <button
            key={question.label}
            type="button"
            onClick={() => onPick(question)}
            className="border-input hover:bg-muted text-foreground rounded-full border px-3 py-1 text-left text-xs transition-colors"
          >
            {question.label}
          </button>
        ))}
      </div>
    </div>
  );
};

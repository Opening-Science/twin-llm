"use client";

import { useCallback, useState } from "react";

import type { CompactCardState } from "./compact-draft-card";
import { compactStartFor, errorSentence, parseCompactResponse } from "./compact-state";

/**
 * `/compact` in the chat: asks for a draft of the saved thread, or says why
 * it cannot (incognito, nothing asked yet). The card's state lives here and
 * nowhere else; nothing is stored until the card's Save note.
 */

const FAILED = "The note couldn't be drafted just now. Try again.";

const readDraft = async (threadId: string): Promise<CompactCardState> => {
  try {
    const response = await fetch("/api/memory/compact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId }),
    });
    const body: unknown = await response.json().catch(() => null);
    const parsed = response.ok ? parseCompactResponse(body) : null;
    return parsed === null
      ? { kind: "message", message: errorSentence(body, FAILED) }
      : { kind: "draft", threadId, ...parsed };
  } catch {
    return { kind: "message", message: FAILED };
  }
};

export const useCompactNote = (threadId: string | null, incognito: boolean) => {
  const [card, setCard] = useState<CompactCardState | null>(null);
  const open = useCallback(() => {
    const start = compactStartFor({ threadId, incognito });
    if (start.kind === "refuse") {
      setCard({ kind: "message", message: start.message });
      return;
    }
    setCard({ kind: "loading" });
    void readDraft(start.threadId).then(setCard);
  }, [threadId, incognito]);
  return {
    card,
    open,
    saved: () => setCard({ kind: "saved" }),
    close: () => setCard(null),
  };
};

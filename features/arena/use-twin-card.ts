"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadCohortPeople } from "@/features/digital-twin/biomarkers/cohort-client";

import type { TurnState } from "./conversation";
import {
  readTwinCard,
  type TwinCard,
  type TwinCardAction,
  twinCardReducer,
  writeTwinCard,
} from "./twin-card-state";
import {
  type ShownSubject,
  type TwinCohortPerson,
  type TwinDataMode,
  twinLabel,
  type TwinTarget,
  twinTarget,
} from "./twin-subject";

/**
 * The `/twin` card's state for one conversation: open or collapsed, kept per
 * thread in sessionStorage; which twin it shows; and a ref that scrolls to it
 * when `/twin` is used again. Nothing here starts a turn or calls a model.
 */

const session = (): Storage | null =>
  typeof window === "undefined" ? null : window.sessionStorage;

/** undefined while the cohort list loads; null when it failed (the Demo body is shown). */
type Cohort = readonly TwinCohortPerson[] | null | undefined;

export const useTwinCard = ({
  initialThreadId,
  threadId,
  turns,
  mode,
}: Readonly<{
  /** The thread the screen opened on; its saved card is restored once. */
  initialThreadId: string | null;
  /** The thread now, which a first send turns from null into an id. */
  threadId: string | null;
  turns: readonly TurnState[];
  mode: TwinDataMode;
}>) => {
  const [card, setCard] = useState<TwinCard | null>(null);
  const [cohort, setCohort] = useState<Cohort>(undefined);
  const [shown, setShown] = useState<ShownSubject | null>(null);
  const [scrollRequest, setScrollRequest] = useState(0);
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (initialThreadId === null) return;
    setCard(readTwinCard(session, initialThreadId));
  }, [initialThreadId]);

  // An open card is saved under the thread, also once a first send gives it an id.
  useEffect(() => {
    if (threadId !== null && card !== null) writeTwinCard(session, threadId, card);
  }, [threadId, card]);

  const open = card !== null;
  useEffect(() => {
    if (!open || mode !== "synthetic" || cohort !== undefined) return;
    let current = true;
    void loadCohortPeople().then((people) => {
      if (current) setCohort(people);
    });
    return () => {
      current = false;
    };
  }, [open, mode, cohort]);

  useEffect(() => {
    if (scrollRequest === 0) return;
    cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [scrollRequest]);

  const act = useCallback(
    (action: TwinCardAction) => {
      setCard((current) => twinCardReducer(current, action));
      // A closed card is forgotten; an open one is saved by the effect above.
      if (action.type === "close" && threadId !== null) {
        writeTwinCard(session, threadId, null);
      }
    },
    [threadId],
  );

  const openCard = useCallback(() => {
    act({ type: "open", turnCount: turns.length });
    setScrollRequest((count) => count + 1);
  }, [act, turns.length]);

  // While the synthetic cohort loads, the subject is not known yet.
  const target: TwinTarget | null = useMemo(
    () =>
      mode === "synthetic" && cohort === undefined
        ? null
        : twinTarget({ mode, turns, cohort: cohort ?? [] }),
    [mode, cohort, turns],
  );

  return {
    card,
    cardRef,
    target,
    /** Changes only when the subject does, so the viewer restarts on the right one. */
    targetKey:
      target === null ? "" : target.kind === "synthetic" ? target.ref : target.kind,
    label: target === null ? "Digital twin" : twinLabel(target, shown),
    onShown: setShown,
    open: openCard,
    collapse: useCallback(() => act({ type: "collapse" }), [act]),
    expand: useCallback(() => act({ type: "expand" }), [act]),
    close: useCallback(() => act({ type: "close" }), [act]),
  };
};

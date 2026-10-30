"use client";

import { useEffect, useRef, useState } from "react";

import {
  type Commit,
  createSoftDelete,
  guardsUnload,
  type SoftDelete,
  type SoftDeletePhase,
} from "./soft-delete";

/**
 * `createSoftDelete` for a component: its phase and error as state, the
 * browser's leave prompt while a delete is unfinished, and the delete run
 * early when the component unmounts inside the window (see `soft-delete.ts`).
 * `commit` is read when it runs, so it may close over fresh props.
 */
export type SoftDeleteControls = Readonly<{
  act: () => void;
  undo: () => void;
  expire: () => void;
}>;

export const useSoftDelete = (
  commit: Commit,
): Readonly<{
  phase: SoftDeletePhase;
  error: string | null;
  controls: SoftDeleteControls;
}> => {
  const [phase, setPhase] = useState<SoftDeletePhase>("shown");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(commit);
  useEffect(() => {
    latest.current = commit;
  }, [commit]);
  const [item] = useState<SoftDelete>(() =>
    createSoftDelete((next, failure) => {
      setPhase(next);
      setError(failure);
    }),
  );

  useEffect(() => () => item.leave(() => latest.current()), [item]);

  const guard = guardsUnload(phase);
  useEffect(() => {
    if (!guard) return;
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [guard]);

  return {
    phase,
    error,
    controls: {
      act: item.act,
      undo: item.undo,
      expire: () => item.expire(() => latest.current()),
    },
  };
};

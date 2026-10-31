/**
 * The soft step behind an `UndoButton` delete, as plain values.
 *
 * Pressing Delete only hides the item (`pending`). The server is asked to
 * delete it when the undo window ends (`expire`), never before, so Undo
 * needs no request and leaves no audit row: only the real delete is
 * audited. A refused or failed delete shows the item again with the reason.
 *
 * Leaving while the window is open:
 * - Going to another page in the app (`leave`) ends the window early and
 *   the delete runs then, because moving on is not Undo.
 * - Closing or reloading the tab makes the browser ask first
 *   (`guardsUnload`). If the person leaves anyway, no request is sent and
 *   nothing is deleted; the item is back on the next visit.
 */

export type SoftDeletePhase = "shown" | "pending" | "deleting" | "deleted" | "failed";

export type SoftDeleteEvent = "act" | "undo" | "expire" | "ok" | "fail";

export const softDeleteReducer = (
  phase: SoftDeletePhase,
  event: SoftDeleteEvent,
): SoftDeletePhase => {
  switch (event) {
    case "act":
      return phase === "shown" || phase === "failed" ? "pending" : phase;
    case "undo":
      return phase === "pending" ? "shown" : phase;
    case "expire":
      return phase === "pending" ? "deleting" : phase;
    case "ok":
      return phase === "deleting" ? "deleted" : phase;
    case "fail":
      return phase === "deleting" ? "failed" : phase;
  }
};

/** Whether the item is out of its list: from the press until a failure. */
export const isSoftHidden = (phase: SoftDeletePhase): boolean =>
  phase === "pending" || phase === "deleting" || phase === "deleted";

/** Whether closing the tab now would drop an unfinished delete. */
export const guardsUnload = (phase: SoftDeletePhase): boolean =>
  phase === "pending" || phase === "deleting";

/** Null when the delete went through, else the sentence to show. */
export type Commit = () => Promise<string | null>;

export type SoftDelete = Readonly<{
  act: () => void;
  undo: () => void;
  /** The undo window ran out. */
  expire: (commit: Commit) => void;
  /** The view is going away (another page in the app). */
  leave: (commit: Commit) => void;
  phase: () => SoftDeletePhase;
}>;

/**
 * One item's soft delete. The `commit` handed to `expire` or `leave` is
 * called at most once per press, and only while pending. `onChange` hears
 * every phase change and the error sentence of a failure (null otherwise).
 */
export const createSoftDelete = (
  onChange: (phase: SoftDeletePhase, error: string | null) => void,
): SoftDelete => {
  // Mutable on purpose: the one item's current phase.
  const state: { phase: SoftDeletePhase } = { phase: "shown" };
  const send = (event: SoftDeleteEvent, error: string | null = null) => {
    const next = softDeleteReducer(state.phase, event);
    if (next === state.phase) return false;
    state.phase = next;
    onChange(next, error);
    return true;
  };
  const run = (commit: Commit) => {
    if (!send("expire")) return;
    void commit()
      .catch(() => "The delete did not go through. Try again.")
      .then((error) => (error === null ? send("ok") : send("fail", error)));
  };
  return {
    act: () => void send("act"),
    undo: () => void send("undo"),
    expire: run,
    leave: run,
    phase: () => state.phase,
  };
};

import { notFound } from "next/navigation";

import type { ResponseState, TurnState } from "./conversation";
import { type SavedResponseRow, toSavedResponseState } from "./saved-response-state";

/**
 * Who may open `/t/<id>`: the person who wrote the thread, and nobody else.
 *
 * A thread can hold someone's questions about their own health, answers that
 * quote their wearable and BodyLoop values, and the evidence entries with
 * those values in them. A thread id is not a secret (it is a CUID and it shows
 * up in the address bar, in browser history and in analytics), so a page that
 * opened for anyone holding the link would publish all of that. There is no
 * sharing: "Copy link" gives the owner a link back to their own thread, and
 * for anyone else the page does not exist. A signed-out visitor, another
 * account and a made-up id all get the same 404, so the page does not even
 * confirm that a thread exists.
 *
 * The reads are injected so the rule is tested with plain values.
 *
 * `requireOwnedThread` turns "nothing" into Next's 404. The route calls it in
 * its layout, above the loading boundary: once a loading fallback has been
 * streamed the status is fixed at 200, and a 404 thrown after that point only
 * changes the page body (#1).
 */

export type StoredThread = Readonly<{
  id: string;
  userId: string;
  title: string;
  turns: readonly Readonly<{
    id: string;
    prompt: string;
    responses: readonly SavedResponseRow[];
  }>[];
}>;

export type ThreadReads = Readonly<{
  /** The signed-in actor (the local actor when auth is off), or null. */
  actorId: () => Promise<string | null>;
  appUserIdFor: (actorId: string) => Promise<string | null>;
  /**
   * The thread with its sealed columns opened (#141). The viewer is passed so
   * a thread of someone else is never opened, only refused.
   */
  findThread: (threadId: string, viewerId: string) => Promise<StoredThread | null>;
  /** The skill each turn ran under, from its `skill.<name>` audit rows. */
  skillsOfTurns: (turnIds: readonly string[]) => Promise<ReadonlyMap<string, string>>;
}>;

export type OwnedThread = Readonly<{
  id: string;
  title: string;
  turns: readonly TurnState[];
}>;

/** Rows written before the position was stored sort after numbered rows. */
const NO_POSITION = Number.MAX_SAFE_INTEGER;

/**
 * Rows in the order the models were picked. Rows without a position keep
 * the order they came in.
 */
export const inPickOrder = (rows: readonly SavedResponseRow[]): SavedResponseRow[] =>
  [...rows].sort((a, b) => (a.position ?? NO_POSITION) - (b.position ?? NO_POSITION));

/**
 * The skill a saved turn ran under: its audit row, which is written before any
 * model is called, or else a stored answer's response document.
 */
const skillOfTurn = (
  turnId: string,
  answers: readonly ResponseState[],
  fromAudit: ReadonlyMap<string, string>,
): string | null =>
  fromAudit.get(turnId) ??
  answers.find((answer) => answer.document?.skill !== undefined)?.document?.skill ??
  null;

export const loadOwnedThread = async (
  threadId: string,
  reads: ThreadReads,
): Promise<OwnedThread | null> => {
  const actorId = await reads.actorId();
  if (!actorId) return null;
  const viewerId = await reads.appUserIdFor(actorId);
  if (!viewerId) return null;

  const thread = await reads.findThread(threadId, viewerId);
  if (!thread || thread.userId !== viewerId) return null;

  const skills = await reads.skillsOfTurns(thread.turns.map((turn) => turn.id));
  return {
    id: thread.id,
    title: thread.title,
    turns: thread.turns.map((turn) => {
      const answers = inPickOrder(turn.responses).map(toSavedResponseState);
      return {
        id: turn.id,
        prompt: turn.prompt,
        skill: skillOfTurn(turn.id, answers, skills),
        answers,
      };
    }),
  };
};

export const requireOwnedThread = async (
  threadId: string,
  reads: ThreadReads,
): Promise<OwnedThread> => {
  const thread = await loadOwnedThread(threadId, reads);
  if (!thread) notFound();
  return thread;
};

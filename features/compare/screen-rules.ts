import { DEFAULT_EFFORT, type EffortLevel } from "@/infrastructure/chat-effort";

import type { TurnState } from "./conversation";

/** Screen-level rules without React (SPEC 3.2, 7.2, 7.9, 11). */

/**
 * After the first send of a saved chat the address becomes `/t/<id>` without
 * a navigation, so the open streams survive (SPEC 2.3). The state is `null`
 * on purpose: Next.js skips syncing its router with a history entry that
 * carries its own state, and the thread bar would then wait for a reload.
 */
export const showThreadAddress = (
  threadId: string,
  history: Pick<History, "replaceState"> = window.history,
): void => {
  history.replaceState(null, "", `/t/${threadId}`);
};

/** The bubble's text: a starter question's short text, else the prompt. */
export const displayText = (turn: Pick<TurnState, "prompt" | "label">): string =>
  turn.label ?? turn.prompt;

/** The page's hidden heading: the first turn's display text, or the product name. */
export const pageHeading = (turns: readonly TurnState[]): string => {
  const first = turns[0];
  return first === undefined ? "TwinLLM" : displayText(first);
};

/** A thread carries on at the effort its last turn ran at; a new chat starts at Balanced. */
export const lastTurnEffort = (turns: readonly TurnState[]): EffortLevel => {
  const last = turns.at(-1);
  if (last === undefined) return DEFAULT_EFFORT;
  return (
    last.effort ??
    last.answers.find((answer) => answer.document?.effort !== undefined)?.document?.effort
      ?.level ??
    DEFAULT_EFFORT
  );
};

/** The answer ids of the last turn, from which a reopened thread picks its mode and models. */
export const lastTurnModelIds = (
  turns: readonly TurnState[],
): readonly string[] | null => {
  const last = turns.at(-1);
  return last === undefined ? null : last.answers.map((answer) => answer.modelId);
};

const HOME = "/";

/** A new generation whenever the path comes back to `/` from elsewhere. */
export const nextGeneration = (
  generation: number,
  previousPath: string | null,
  path: string | null,
): number => (path === HOME && previousPath !== HOME ? generation + 1 : generation);

import type { SpeechLanguage } from "@/infrastructure/speech/contract";
import { organNamed } from "@/infrastructure/speech/organ-named";
import type { TwinFocusId } from "@/packages/anatomy/twin-focus";

import { finishedAnswer, isWithheld } from "./answer-text";
import type { TurnState } from "./conversation";

/**
 * Which turn was asked aloud, and the answer to read back (#616). Kept in the
 * browser only: a reloaded thread has no spoken turns. Pure.
 */

export type SpokenTurn = Readonly<{
  /** The turn's place in the conversation when it was sent. */
  index: number;
  language: SpeechLanguage;
}>;

export type SpokenAnswer = Readonly<{
  id: string;
  /** The Answer section in words, as the column shows it. */
  text: string;
  prompt: string;
  /** The focus of a body twin the answer drew itself, if it drew one. */
  shownFocus: TwinFocusId | null;
}>;

/**
 * The first answer of the spoken turn that finished with words to say: the
 * one to read aloud. Null while every answer is still running, and for one
 * that failed, was stopped or withheld.
 */
export const spokenAnswer = (
  turns: readonly TurnState[],
  spoken: SpokenTurn | null,
): SpokenAnswer | null => {
  if (spoken === null) return null;
  const turn = turns[spoken.index];
  if (turn === undefined) return null;
  const answers = turn.answers.flatMap((answer) => {
    if (answer.status !== "COMPLETE" || answer.stopped === true) return [];
    if (answer.refusal !== undefined || isWithheld(answer.document)) return [];
    const text = finishedAnswer(answer.text).answer;
    if (text === "") return [];
    const shown = (answer.views ?? []).find((view) => view.kind === "twin.body");
    const shownFocus = shown?.kind === "twin.body" ? shown.spec.focus : null;
    return [{ id: answer.id, text, prompt: turn.prompt, shownFocus }];
  });
  return answers[0] ?? null;
};

/**
 * Where the chat's twin turns after a spoken answer (#616): the body twin the
 * answer drew, else the organ its words name first, else the question's.
 * Null when it names none, and the twin stays as it is.
 */
export const twinTurnOf = (answer: SpokenAnswer): TwinFocusId | null =>
  answer.shownFocus ?? organNamed(answer.text, answer.prompt);

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which answer of a turn a tool call belongs to (#856). The answers of a
 * Compare or Specialists turn share the turn's id as their audit session, so
 * the audit rows and the sources the searches collect are told apart here:
 * each answer runs its tool calls inside `withinAnswer`, the audit chain
 * notes the `seq` of every row written there, and the collectors key their
 * sources by `answerKey`. Outside an answer everything keys by the turn, as
 * before.
 */

type Answer = Readonly<{ turnId: string; answerId: string }>;

const current = new AsyncLocalStorage<Answer>();
const seqs = new Map<string, number[]>();

/** The key one answer of a turn collects under: the turn alone without one. */
export const answerKey = (turnId: string, answerId: string | null): string =>
  answerId === null ? turnId : `${turnId}#${answerId}`;

/** Runs `work` (a tool call) as part of one answer of the turn. */
export const withinAnswer = <T>(turnId: string, answerId: string, work: () => T): T =>
  current.run({ turnId, answerId }, work);

/**
 * The key a collector records under for `sessionId`: the answer's, when the
 * call runs inside an answer of that turn, else the session's own.
 */
export const collectorKey = (sessionId: string): string => {
  const answer = current.getStore();
  return answer !== undefined && answer.turnId === sessionId
    ? answerKey(answer.turnId, answer.answerId)
    : sessionId;
};

/** Notes an audit row written inside an answer of its own session. */
export const noteAnswerAudit = (sessionId: string, seq: bigint | number): void => {
  const answer = current.getStore();
  if (answer === undefined || answer.turnId !== sessionId) return;
  const key = answerKey(answer.turnId, answer.answerId);
  seqs.set(key, [...(seqs.get(key) ?? []), Number(seq)]);
};

/** The `seq` of every audit row the answer's tool calls wrote, once. */
export const drainAnswerAudit = (turnId: string, answerId: string): ReadonlySet<number> => {
  const key = answerKey(turnId, answerId);
  const noted = new Set(seqs.get(key) ?? []);
  seqs.delete(key);
  return noted;
};

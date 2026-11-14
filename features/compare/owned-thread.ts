import type { FieldCipher } from "@/infrastructure/field-cipher";
import {
  openPrompt,
  openResponse,
  openThreadTitle,
  openTurnLabel,
} from "@/infrastructure/thread-fields";

import type { OwnedThread, TurnState } from "./conversation";
import { savedAnswer, type StoredAnswerRow } from "./saved-answer";

/**
 * Who may read a thread: the person who wrote it, nobody else (SERVER-SPEC
 * 3.6). Someone else's thread reads exactly like one that does not exist,
 * and is refused before any sealed column is opened.
 */

type SealedAnswerRow = Omit<
  StoredAnswerRow,
  "attribution" | "responseDocument" | "toolParts" | "tokensPerSecond" | "costUsd"
> &
  Readonly<{
    position: number | null;
    attribution: string | null;
    responseDocument: string | null;
    toolParts: string | null;
    tokensPerSecond: { toNumber: () => number } | number | null;
    costUsd: { toNumber: () => number } | number;
  }>;

export type StoredThread = Readonly<{
  id: string;
  userId: string;
  title: string;
  turns: readonly Readonly<{
    id: string;
    prompt: string;
    skill: string | null;
    label: string | null;
    scheduled: boolean;
    responses: readonly SealedAnswerRow[];
  }>[];
}>;

export type ThreadReads = Readonly<{
  actorId: () => Promise<string | null>;
  appUserIdFor: (actorId: string) => Promise<string | null>;
  /** The thread with turns oldest first, each with its answer rows. */
  readThread: (threadId: string) => Promise<StoredThread | null>;
  cipherFor: (userId: string) => Promise<FieldCipher>;
}>;

const decimal = (value: { toNumber: () => number } | number | null): number | null =>
  value === null ? null : typeof value === "number" ? value : value.toNumber();

/** Pick order; rows written before positions existed come after, as stored. */
export const inPickOrder = <T extends Readonly<{ position: number | null }>>(
  rows: readonly T[],
): T[] => {
  const indexed = rows.map((row, index) => ({ row, index }));
  return indexed
    .sort((a, b) => {
      const pa = a.row.position ?? Number.POSITIVE_INFINITY;
      const pb = b.row.position ?? Number.POSITIVE_INFINITY;
      return pa === pb ? a.index - b.index : pa - pb;
    })
    .map(({ row }) => row);
};

export const loadOwnedThread = async (
  threadId: string,
  reads: ThreadReads,
): Promise<OwnedThread | null> => {
  const actor = await reads.actorId();
  if (actor === null) return null;
  const viewer = await reads.appUserIdFor(actor);
  if (viewer === null) return null;
  const thread = await reads.readThread(threadId);
  if (thread === null || thread.userId !== viewer) return null;

  const cipher = await reads.cipherFor(thread.userId);
  const turns = thread.turns.map((turn): TurnState => {
    const label = openTurnLabel(cipher, turn.id, turn.label);
    return {
      id: turn.id,
      prompt: openPrompt(cipher, turn.id, turn.prompt),
      skill: turn.skill,
      ...(label === null ? {} : { label }),
      ...(turn.scheduled ? { scheduled: true as const } : {}),
      answers: inPickOrder(turn.responses).map((row) => {
        const opened = openResponse(cipher, row);
        return savedAnswer({
          ...opened,
          reasoningText: opened.reasoningText ?? null,
          tokensPerSecond: decimal(row.tokensPerSecond),
          costUsd: decimal(row.costUsd) ?? 0,
        });
      }),
    };
  });
  return {
    id: thread.id,
    title: openThreadTitle(cipher, thread.id, thread.title),
    turns,
  };
};

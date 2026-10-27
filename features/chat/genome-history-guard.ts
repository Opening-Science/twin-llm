import {
  assertHistoryMayLeave,
  GENOME_THREAD_LOCAL_ONLY,
  GENOME_THREAD_SENTENCE,
} from "@/infrastructure/genome-thread-policy";

import type { ChatRequest } from "./chat-request";

/**
 * The last check before a turn's history goes to a model (#151), behind the
 * per-thread refusal in `start-answer.ts`. If a genome-personal thread, or a
 * history that shows genome use, reached a model that is not local, nothing
 * is sent: the row is stored as REFUSED with the thread sentence and the
 * caller gets the same 400 as the first check. Returns null when the history
 * may go.
 */
export type GenomeHistoryGuardDeps = Readonly<{
  chatIsLocal: () => boolean;
  markRefused: (
    target: Readonly<{ turnId: string; modelId: string; sentence: string }>,
  ) => Promise<void>;
}>;

export const guardGenomeHistory = async (
  deps: GenomeHistoryGuardDeps,
  request: Pick<ChatRequest, "turnId" | "modelId" | "messages">,
  genomeThread: boolean,
): Promise<Response | null> => {
  try {
    assertHistoryMayLeave({
      chatIsLocal: deps.chatIsLocal(),
      genomeThread,
      messages: request.messages,
    });
    return null;
  } catch {
    console.error(`[chat] ${request.modelId} genome history held back`);
    await deps
      .markRefused({
        turnId: request.turnId,
        modelId: request.modelId,
        sentence: GENOME_THREAD_SENTENCE,
      })
      .catch(() => console.error("[chat] could not store the refusal"));
    return Response.json(
      { code: GENOME_THREAD_LOCAL_ONLY, error: GENOME_THREAD_SENTENCE },
      { status: 400 },
    );
  }
};

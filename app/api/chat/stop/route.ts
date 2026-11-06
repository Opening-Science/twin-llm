import { answerOwnership } from "@/features/chat/answer-ownership";
import { runningAnswers } from "@/features/chat/running-answers";
import { createStopChatHandler } from "@/features/chat/stop-chat";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { withUnlocked } from "@/infrastructure/vault-runtime";

/** Ends one running answer of the caller's (`features/chat/stop-chat.ts`, #373). */
export const POST = withUnlocked(
  createStopChatHandler({
    resolveActorId,
    ownership: answerOwnership,
    stop: (answer, mayStillStart) => runningAnswers().stop(answer, mayStillStart),
  }),
);

import "server-only";

import { detectBot, tokenBucket } from "@arcjet/next";

import { arcjetClient } from "@/infrastructure/arcjet";
import { toProtectionVerdict } from "@/infrastructure/protection-verdict";

import { CHAT_BUCKET_INTERVAL_S, type ChatCheck, runChatGuard } from "./chat-guard";

/**
 * Abuse protection in front of every model call.
 *
 * A turn with three models is three requests, so the budget is a token bucket
 * keyed on the person, not on the request: picking more models spends the same
 * allowance faster instead of multiplying it. Each call costs one token. Bots
 * are refused, since only this app's own browser code calls the endpoint and
 * every accepted call spends real inference.
 *
 * Prompt-injection scanning is not enabled. Arcjet sells it as a separate
 * add-on; on an account without it the rule errors on every request. If the
 * add-on is bought, add `detectPromptInjection` to the rules and pass the
 * newest user message when protecting.
 *
 * Without ARCJET_KEY (auth-off demos) there is no check at all.
 */
const BUCKET = {
  refillRate: 15,
  interval: CHAT_BUCKET_INTERVAL_S,
  capacity: 30,
} as const;
const COST_PER_MODEL_CALL = 1;

const buildChatCheck = (): ChatCheck | null => {
  const base = arcjetClient();
  if (base === null) return null;
  const rules = base
    .withRule(detectBot({ mode: "LIVE", allow: [] }))
    .withRule(tokenBucket({ mode: "LIVE", characteristics: ["userId"], ...BUCKET }));
  return async (request, userId) =>
    toProtectionVerdict(
      await rules.protect(request, { userId, requested: COST_PER_MODEL_CALL }),
    );
};

const memo: { check?: ChatCheck | null } = {};

/** Null when the call may proceed; otherwise the response to send back. */
export const guardChatRequest = async (
  request: Request,
  userId: string,
): Promise<Response | null> => {
  if (memo.check === undefined) memo.check = buildChatCheck();
  return runChatGuard(memo.check, request, userId);
};

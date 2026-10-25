import type { ProtectionVerdict } from "@/infrastructure/protection-verdict";

/**
 * The response side of chat abuse protection, free of Arcjet so it can be
 * tested with a plain fake check. `chat-protection.ts` supplies the real one.
 */
export type ChatCheck = (request: Request, userId: string) => Promise<ProtectionVerdict>;

/** Seconds in one refill interval of the per-person token bucket. */
export const CHAT_BUCKET_INTERVAL_S = 60;

/** Whole seconds until the bucket refills, never less than one. */
export const retryAfterSeconds = (resetAt: Date | null, nowMs: number): number =>
  resetAt === null
    ? CHAT_BUCKET_INTERVAL_S
    : Math.max(1, Math.ceil((resetAt.getTime() - nowMs) / 1000));

/** Turns a verdict into a JSON error response, or null to continue. */
export const chatResponseFor = (
  verdict: ProtectionVerdict,
  nowMs: number = Date.now(),
): Response | null => {
  switch (verdict.kind) {
    case "allowed":
      return null;
    case "unavailable":
      console.error("[chat] protection check unavailable; allowing", verdict.detail);
      return null;
    case "rate-limited": {
      const wait = retryAfterSeconds(verdict.resetAt, nowMs);
      return Response.json(
        {
          error: `You've sent a lot of prompts in a short time. Try again in ${wait} seconds.`,
        },
        { status: 429, headers: { "retry-after": `${wait}` } },
      );
    }
    case "blocked":
      return Response.json(
        { error: "This request was blocked. If you think that's wrong, try again." },
        { status: 403 },
      );
  }
};

/** Null when the call may proceed; otherwise the response to send back. */
export const runChatGuard = async (
  check: ChatCheck | null,
  request: Request,
  userId: string,
): Promise<Response | null> =>
  check === null ? null : chatResponseFor(await check(request, userId));

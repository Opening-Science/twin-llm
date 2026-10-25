import type { ProtectionVerdict } from "@/infrastructure/protection-verdict";

/**
 * The response side of thread-page protection, free of Arcjet so it can be
 * tested with a plain fake check. `thread-protection.ts` supplies the real one.
 */
export type ThreadCheck = (request: Request) => Promise<ProtectionVerdict>;

/** Turns a verdict into the response to send, or null to let the page render. */
export const threadResponseFor = (verdict: ProtectionVerdict): Response | null => {
  switch (verdict.kind) {
    case "allowed":
      return null;
    case "unavailable":
      console.error("[thread] protection check unavailable; allowing", verdict.detail);
      return null;
    case "rate-limited":
      return new Response("Too many requests. Try again shortly.", { status: 429 });
    case "blocked":
      return new Response("This request was blocked.", { status: 403 });
  }
};

export const runThreadGuard = async (
  check: ThreadCheck | null,
  request: Request,
): Promise<Response | null> =>
  check === null ? null : threadResponseFor(await check(request));

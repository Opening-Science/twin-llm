import type { ArcjetDecision } from "@arcjet/next";

/**
 * Arcjet's decision reduced to the four outcomes a route acts on.
 *
 * Routes never branch on Arcjet classes directly, so their guards can be
 * tested with a plain fake that returns one of these, and an Arcjet reason
 * can never leak into a response by accident.
 */
export type ProtectionVerdict =
  | Readonly<{ kind: "allowed" }>
  | Readonly<{ kind: "blocked" }>
  | Readonly<{ kind: "rate-limited"; resetAt: Date | null }>
  /** Arcjet could not decide. Routes fail open and log `detail` server-side. */
  | Readonly<{ kind: "unavailable"; detail: string }>;

export const toProtectionVerdict = (decision: ArcjetDecision): ProtectionVerdict => {
  if (decision.isErrored())
    return { kind: "unavailable", detail: decision.reason.message };
  if (decision.isAllowed()) return { kind: "allowed" };
  if (decision.reason.isRateLimit()) {
    return { kind: "rate-limited", resetAt: decision.reason.resetTime ?? null };
  }
  return { kind: "blocked" };
};

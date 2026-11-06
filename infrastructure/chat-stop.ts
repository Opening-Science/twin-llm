import type { AppendInput } from "@/packages/audit/append";

/** Audit tool of an answer the person stopped (#373). It read nothing. */
export const CHAT_STOP_AUDIT_TOOL = "chat.stop";

/**
 * The audit row written when Stop ends an answer: which model, no text. The
 * model named is the one called, as on the turn's other rows.
 */
export const chatStopEvent = (
  call: Readonly<{ actor: string; sessionId: string; modelId: string }>,
): AppendInput => ({
  actor: call.actor,
  sessionId: call.sessionId,
  subjectRef: null,
  tool: CHAT_STOP_AUDIT_TOOL,
  args: { modelId: call.modelId },
  result: {},
  rowCount: 0,
});

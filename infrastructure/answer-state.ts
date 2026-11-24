import type { AnswerState } from "@/generated/prisma/client";

/**
 * An answer's status as the app has always named it, and the `state` the
 * answers table stores (DATA-MODEL.md B.3): the same five values, lower-cased.
 * The app keeps the upper-case names; only the database bindings convert.
 *
 * Pure.
 */

export type AnswerStatus = "STREAMING" | "COMPLETE" | "FAILED" | "REFUSED" | "STOPPED";

const STATE_OF: Readonly<Record<AnswerStatus, AnswerState>> = {
  STREAMING: "streaming",
  COMPLETE: "complete",
  FAILED: "failed",
  REFUSED: "refused",
  STOPPED: "stopped",
};

const STATUS_OF: Readonly<Record<AnswerState, AnswerStatus>> = {
  streaming: "STREAMING",
  complete: "COMPLETE",
  failed: "FAILED",
  refused: "REFUSED",
  stopped: "STOPPED",
};

export const stateOf = (status: AnswerStatus): AnswerState => STATE_OF[status];

export const statusOf = (state: AnswerState): AnswerStatus => STATUS_OF[state];

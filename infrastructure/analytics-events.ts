import "server-only";

import { posthogServer } from "./posthog";

/**
 * Product funnel events: a prompt goes out, each model answers or fails, and
 * a vote is cast. The properties are ids, counts and statuses, never prompt
 * or answer text. Model-call metrics are a separate event, built in
 * `features/chat/generation-analytics.ts`.
 *
 * Every function is a no-op without a PostHog key. The sink is a parameter so
 * tests can collect events without a client.
 */
export type FunnelEvent = Readonly<{
  distinctId: string;
  event: "prompt_sent" | "model_answered" | "vote_cast";
  properties: Readonly<Record<string, string | number | readonly string[]>>;
}>;

export type FunnelSink = (event: FunnelEvent) => void;

const liveSink = (): FunnelSink | null => {
  const client = posthogServer();
  return client === null
    ? null
    : ({ distinctId, event, properties }) =>
        client.capture({ distinctId, event, properties: { ...properties } });
};

const emit = (event: FunnelEvent, sink: FunnelSink | null): void => {
  sink?.(event);
};

export const trackPromptSent = (
  sent: Readonly<{
    clerkId: string;
    threadId: string;
    turnId: string;
    modelIds: readonly string[];
  }>,
  sink: FunnelSink | null = liveSink(),
): void =>
  emit(
    {
      distinctId: sent.clerkId,
      event: "prompt_sent",
      properties: {
        threadId: sent.threadId,
        turnId: sent.turnId,
        modelIds: sent.modelIds,
        modelCount: sent.modelIds.length,
      },
    },
    sink,
  );

export const trackModelAnswered = (
  answered: Readonly<{
    clerkId: string;
    turnId: string;
    modelId: string;
    status: "COMPLETE" | "FAILED";
  }>,
  sink: FunnelSink | null = liveSink(),
): void =>
  emit(
    {
      distinctId: answered.clerkId,
      event: "model_answered",
      properties: {
        turnId: answered.turnId,
        modelId: answered.modelId,
        status: answered.status,
      },
    },
    sink,
  );

export const trackVoteCast = (
  vote: Readonly<{ clerkId: string; turnId: string; modelResponseId: string }>,
  sink: FunnelSink | null = liveSink(),
): void =>
  emit(
    {
      distinctId: vote.clerkId,
      event: "vote_cast",
      properties: { turnId: vote.turnId, modelResponseId: vote.modelResponseId },
    },
    sink,
  );

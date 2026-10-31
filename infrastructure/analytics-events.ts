import "server-only";

import { dataMode } from "./data-mode";
import { telemetryDisclosure } from "./disclosure-ledger";
import { recordDisclosure } from "./disclosure-ledger-runtime";
import { posthogServer } from "./posthog";

/**
 * Product funnel events: a prompt goes out and each model answers or fails.
 * The properties are ids, counts and statuses, never prompt
 * or answer text. Model-call metrics are a separate event, built in
 * `features/chat/generation-analytics.ts`.
 *
 * Every function is a no-op without a PostHog key. The sink is a parameter so
 * tests can collect events without a client.
 *
 * Each event is written to the disclosure ledger (#140) before it is
 * captured; an event whose row cannot be written is dropped.
 */
export type FunnelEvent = Readonly<{
  distinctId: string;
  event: "prompt_sent" | "model_answered";
  properties: Readonly<Record<string, string | number | readonly string[]>>;
}>;

export type FunnelSink = (event: FunnelEvent) => void;

const liveSink = (): FunnelSink | null => {
  const client = posthogServer();
  return client === null
    ? null
    : ({ distinctId, event, properties }) => {
        void recordDisclosure(
          telemetryDisclosure({
            distinctId,
            event,
            synthetic: dataMode() === "synthetic",
          }),
        ).then(
          () => client.capture({ distinctId, event, properties: { ...properties } }),
          (error: unknown) =>
            console.error(
              "[analytics] event dropped: the disclosure ledger could not be written",
              error instanceof Error ? error.name : "unknown",
            ),
        );
      };
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

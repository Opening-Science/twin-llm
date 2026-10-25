import "server-only";

import { PostHog } from "posthog-node";

import { analyticsEnv } from "./env";

/**
 * Server-side PostHog client, or null when no PostHog key is configured.
 *
 * PostHog is optional everywhere; every caller must treat null as "do not
 * send". The client is created on first use so `next build` needs no key.
 * It carries counts and identifiers only: chat text is never passed to it
 * (see `features/chat/generation-analytics.ts`).
 */
const state: { client?: PostHog | null } = {};

export const posthogServer = (): PostHog | null => {
  if (state.client !== undefined) return state.client;
  const settings = analyticsEnv();
  state.client =
    settings === null ? null : new PostHog(settings.key, { host: settings.host });
  return state.client;
};

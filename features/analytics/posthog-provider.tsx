"use client";

import posthog from "posthog-js";
import { PostHogProvider as PostHogReactProvider } from "posthog-js/react";
import { type ReactNode, useEffect } from "react";

import { browserAnalyticsConfig } from "@/infrastructure/public-env";

import { PRIVATE_POSTHOG_OPTIONS, scrubEvent } from "./analytics-privacy";

/**
 * Browser analytics, off unless the deployment opts in (see
 * `browserAnalyticsConfig`). When on, the client starts after hydration with
 * the restricted options in `./analytics-privacy` and talks to the PostHog
 * host directly, so no app cookie is ever forwarded with an event.
 *
 * It does not identify the Clerk user: auth-off mode has no ClerkProvider.
 */
const config = browserAnalyticsConfig();

export const PostHogProvider = ({ children }: Readonly<{ children: ReactNode }>) => {
  useEffect(() => {
    if (config === null || posthog.__loaded) return;
    posthog.init(config.key, {
      ...PRIVATE_POSTHOG_OPTIONS,
      api_host: config.host,
      before_send: scrubEvent,
    });
  }, []);

  if (config === null) return children;
  return <PostHogReactProvider client={posthog}>{children}</PostHogReactProvider>;
};

import type { CaptureResult, PostHogConfig } from "posthog-js";

/**
 * What browser PostHog may record when a deployment turns it on.
 *
 * Pages in this app show health questions, answers and measurements, so the
 * client records pageviews and explicitly captured events only: no
 * autocapture, no session replay, no heatmaps, no exception capture, all text
 * and attributes masked, and nothing persisted in cookies or local storage.
 * Thread ids are removed from URLs before anything is sent.
 */
export const PRIVATE_POSTHOG_OPTIONS = {
  autocapture: false,
  capture_pageview: "history_change",
  capture_pageleave: false,
  disable_session_recording: true,
  enable_heatmaps: false,
  capture_exceptions: false,
  capture_dead_clicks: false,
  rageclick: false,
  mask_all_text: true,
  mask_all_element_attributes: true,
  disable_surveys: true,
  persistence: "memory",
  person_profiles: "identified_only",
} as const satisfies Partial<PostHogConfig>;

const THREAD_PATH = /\/t\/[^/?#]+/g;

/** Replaces every `/t/<id>` path segment with `/t/:id`. */
export const scrubThreadIds = (value: string): string =>
  value.replace(THREAD_PATH, "/t/:id");

const URL_PROPERTIES = [
  "$current_url",
  "$pathname",
  "$referrer",
  "$initial_referrer",
] as const;

/** `before_send` hook: drops thread ids from every URL-like property. */
export const scrubEvent = (event: CaptureResult | null): CaptureResult | null => {
  if (event === null) return null;
  const properties = { ...event.properties };
  URL_PROPERTIES.forEach((name) => {
    const value: unknown = properties[name];
    if (typeof value === "string") properties[name] = scrubThreadIds(value);
  });
  return { ...event, properties };
};

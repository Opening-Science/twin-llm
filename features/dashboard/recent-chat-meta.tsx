"use client";

import { useSyncExternalStore } from "react";

import { recentChatMeta } from "./dashboard-sections";

const noSubscription = () => () => {};

const viewerZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * A recent chat's day and model count in the reader's time zone. The server
 * and the first browser render use UTC, so hydration matches; the browser
 * then shows the reader's own calendar day, as the sidebar does.
 */
export const RecentChatMeta = ({
  updatedAt,
  modelCount,
}: Readonly<{ updatedAt: string; modelCount: number }>) => {
  const timeZone = useSyncExternalStore(noSubscription, viewerZone, () => "UTC");
  return <>{recentChatMeta(updatedAt, modelCount, timeZone)}</>;
};

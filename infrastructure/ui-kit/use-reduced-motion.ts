"use client";

import { useSyncExternalStore } from "react";

/**
 * The viewer's reduced-motion setting, for motion that CSS cannot reach
 * (Web Animations). CSS motion is already calmed in globals.css. The server
 * and the first paint assume full motion is fine.
 */
const QUERY = "(prefers-reduced-motion: reduce)";

const subscribe = (listener: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};

export const useReducedMotion = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );

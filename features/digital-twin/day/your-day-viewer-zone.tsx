"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { YOUR_DAY_COPY } from "../twin-page-copy";
import { yourDayZoneCookie } from "./your-day-zone";

/**
 * Stores the browser's zone in the Your Day cookie and asks the server page to
 * render again. With `fallback` (the server refused the stored zone) it stores
 * UTC, so a zone the server cannot read never loops.
 */
export function YourDayViewerZone({
  fallback = false,
}: Readonly<{ fallback?: boolean }>) {
  const router = useRouter();
  useEffect(() => {
    const zone = fallback ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone;
    document.cookie = yourDayZoneCookie(zone, window.location.protocol === "https:");
    router.refresh();
  }, [fallback, router]);
  return (
    <p role="status" className="text-muted-foreground text-sm">
      {YOUR_DAY_COPY.personal.findingZone}
    </p>
  );
}

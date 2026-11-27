"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** The replay URL with the viewer's zone, keeping the path and other parameters. */
export function withViewerZone(href: string, zone: string) {
  const url = new URL(href);
  url.searchParams.set("zone", zone || "UTC");
  return `${url.pathname}${url.search}`;
}

/** Personal replay cuts days in the viewer's zone, which only the browser knows. */
export function YourDayViewerZone() {
  const router = useRouter();
  useEffect(() => {
    router.replace(
      withViewerZone(
        window.location.href,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    );
  }, [router]);
  return (
    <p role="status" className="text-muted-foreground text-sm">
      Finding your time zone…
    </p>
  );
}

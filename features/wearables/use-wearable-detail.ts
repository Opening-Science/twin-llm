"use client";

import { useEffect, useState } from "react";

import type { WearableSource } from "./dashboard-headings";
import type { DateRangeValue } from "./date-range-bar";
import type { WearablesDetailResponse } from "./detail-handler";
import type { WearableDetail } from "./wearable-detail";

/**
 * The detail charts' data for the source and window on screen, from this
 * app's own `/api/wearables/detail`. "loading" until it answers, null when it
 * cannot (signed out, locked or failed): the cards that need it then stay
 * away rather than show an error. `snapshot` changes after a sync, so a new
 * snapshot is read again.
 */
export const useWearableDetail = (
  source: WearableSource,
  range: DateRangeValue,
  snapshot: unknown,
): WearableDetail | "loading" | null => {
  const [detail, setDetail] = useState<WearableDetail | "loading" | null>("loading");

  useEffect(() => {
    if (!snapshot) {
      setDetail(null);
      return;
    }
    const abort = new AbortController();
    setDetail("loading");
    const query = new URLSearchParams({
      source,
      start: range.startDate,
      end: range.endDate,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
    fetch(`/api/wearables/detail?${query.toString()}`, { signal: abort.signal })
      .then(async (res) =>
        res.ok ? ((await res.json()) as WearablesDetailResponse).detail : null,
      )
      .then(
        (next) => setDetail(next),
        () => {
          if (!abort.signal.aborted) setDetail(null);
        },
      );
    return () => abort.abort();
  }, [source, range.startDate, range.endDate, snapshot]);

  return detail;
};

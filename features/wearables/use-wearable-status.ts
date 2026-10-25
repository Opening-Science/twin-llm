"use client";

import { useCallback, useEffect, useState } from "react";

export type WearableStatus = {
  readonly configured: boolean;
  readonly connected: boolean;
  readonly linkedAt: string | null;
  readonly lastSyncAt: string | null;
  readonly signedIn: boolean;
};

export type WearablesState = {
  readonly oura: WearableStatus | null;
  readonly whoop: WearableStatus | null;
  readonly googleHealth: WearableStatus | null;
  readonly refresh: () => Promise<void>;
};

/**
 * Live wearable link status for composer chips + `/` connect menu.
 */
export const useWearableStatus = (): WearablesState => {
  const [oura, setOura] = useState<WearableStatus | null>(null);
  const [whoop, setWhoop] = useState<WearableStatus | null>(null);
  const [googleHealth, setGoogleHealth] = useState<WearableStatus | null>(null);

  const refresh = useCallback(async () => {
    const [ouraRes, whoopRes, googleRes] = await Promise.all([
      fetch("/api/oura/status"),
      fetch("/api/whoop/status"),
      fetch("/api/google-health/status"),
    ]);
    if (ouraRes.ok) setOura((await ouraRes.json()) as WearableStatus);
    if (whoopRes.ok) setWhoop((await whoopRes.json()) as WearableStatus);
    if (googleRes.ok) setGoogleHealth((await googleRes.json()) as WearableStatus);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [ouraRes, whoopRes, googleRes] = await Promise.all([
        fetch("/api/oura/status"),
        fetch("/api/whoop/status"),
        fetch("/api/google-health/status"),
      ]);
      if (cancelled) return;
      if (ouraRes.ok) setOura((await ouraRes.json()) as WearableStatus);
      if (whoopRes.ok) setWhoop((await whoopRes.json()) as WearableStatus);
      if (googleRes.ok) setGoogleHealth((await googleRes.json()) as WearableStatus);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { oura, whoop, googleHealth, refresh };
};

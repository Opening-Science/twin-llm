"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { type ReplayKey } from "@/packages/query-tools/replay/replay-day";

import {
  createReplayTransport,
  type ReplayFrameClock,
  type ReplayStory,
} from "./replay-transport";

const browserClock: ReplayFrameClock = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
};

const TransportContext = createContext<ReturnType<typeof createReplayTransport> | null>(
  null,
);

type ReplayProviderProps = Readonly<{
  selection: ReplayKey;
  story?: ReplayStory | null;
  children: ReactNode;
}>;

/** Mount only while Your Day is open. A new selection owns a fresh clock. */
export function ReplayProvider({
  selection,
  story = null,
  children,
}: ReplayProviderProps) {
  const { subject_ref, day, time_zone } = selection;
  const transport = useMemo(
    () => createReplayTransport({ subject_ref, day, time_zone }, browserClock),
    [subject_ref, day, time_zone],
  );
  useLayoutEffect(() => {
    const disconnect = transport.connect();
    window.addEventListener("pagehide", transport.actions.pause);
    return () => {
      window.removeEventListener("pagehide", transport.actions.pause);
      disconnect();
    };
  }, [transport]);
  useLayoutEffect(() => transport.setStory(story), [transport, story]);
  return (
    <TransportContext.Provider value={transport}>{children}</TransportContext.Provider>
  );
}

function useTransport() {
  const transport = useContext(TransportContext);
  if (transport === null) throw new Error("Replay hooks require a ReplayProvider");
  return transport;
}

export function useReplaySnapshot() {
  const transport = useTransport();
  return useSyncExternalStore(
    transport.subscribe,
    transport.getSnapshot,
    transport.getServerSnapshot,
  );
}

export function useReplayActions() {
  return useTransport().actions;
}

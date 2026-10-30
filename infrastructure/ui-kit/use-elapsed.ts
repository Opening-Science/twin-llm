"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Milliseconds since `running` first turned true, ticking while it stays
 * true and frozen when it turns false. Null when it has never run, as for an
 * answer loaded already finished: then there is no honest time to show.
 */
export const useElapsed = (running: boolean, tickMs = 100): number | null => {
  const [elapsed, setElapsed] = useState<number | null>(null);
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    const start = startedAt.current ?? performance.now();
    startedAt.current = start;
    const tick = () => setElapsed(performance.now() - start);
    const frame = requestAnimationFrame(tick);
    const timer = setInterval(tick, tickMs);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      // The last reading is the frozen time.
      tick();
    };
  }, [running, tickMs]);
  return elapsed;
};

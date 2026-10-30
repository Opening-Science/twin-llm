"use client";

import { formatElapsed } from "@/infrastructure/format-measure";
import { cn } from "@/infrastructure/ui";

import {
  LATTICE_WORDS,
  latticeCells,
  type LatticeState,
  waveDelayMs,
} from "./status-lattice-model";
import { useElapsed } from "./use-elapsed";

/**
 * A long job's state in a small dot grid, with its name and a timer. The
 * wave runs while it works; a tick in the success colour or a cross in the
 * danger colour stays when it ends, and the timer stops. The words always
 * say the state too: the grid is decoration for sighted readers, and the
 * live region speaks only when the state changes, never on a timer tick.
 *
 * `elapsedMs`, when given, is the caller's own time (a job that outlives a
 * reload); otherwise the lattice times what it saw.
 */

export type StatusLatticeProps = Readonly<{
  state: LatticeState;
  label: string;
  elapsedMs?: number | null;
  className?: string;
}>;

export const StatusLattice = ({
  state,
  label,
  elapsedMs,
  className,
}: StatusLatticeProps) => {
  const watched = useElapsed(state === "working");
  const shown = elapsedMs ?? watched;
  return (
    <div className={cn("status-lattice", className)} data-state={state}>
      <span className="status-lattice-grid" aria-hidden="true">
        {latticeCells(state).map((on, index) => (
          <span
            // The nine cells never reorder.
            key={index}
            className="status-lattice-dot"
            data-on={on ? "" : undefined}
            style={{ animationDelay: `${waveDelayMs(index)}ms` }}
          />
        ))}
      </span>
      <span className="min-w-0 truncate">{label}</span>
      <span className="text-muted-foreground text-xs" aria-hidden="true">
        {LATTICE_WORDS[state]}
      </span>
      {shown !== null && (
        <span className="status-lattice-timer" aria-hidden="true">
          {formatElapsed(shown)}
        </span>
      )}
      <span role="status" className="sr-only">
        {`${label}: ${LATTICE_WORDS[state]}`}
      </span>
    </div>
  );
};

import type { GbdInput } from "./input";
import type { GbdRow } from "./normalize";

export type GbdSource = {
  readonly tool: string;
  readonly fields: GbdInput;
};

export type GbdTurn = {
  readonly sources: readonly GbdSource[];
  readonly rows: readonly GbdRow[];
};

const turns = new Map<string, { sources: GbdSource[]; rows: GbdRow[] }>();

export const recordGbdTurn = (
  sessionId: string,
  source: GbdSource,
  rows: readonly GbdRow[],
): void => {
  const prev = turns.get(sessionId) ?? { sources: [], rows: [] };
  turns.set(sessionId, {
    sources: [...prev.sources, source],
    rows: [...prev.rows, ...rows],
  });
};

export const drainGbdTurn = (sessionId: string): GbdTurn => {
  const value = turns.get(sessionId);
  turns.delete(sessionId);
  return value ?? { sources: [], rows: [] };
};

export const resetGbdCollectorForTests = (): void => {
  turns.clear();
};

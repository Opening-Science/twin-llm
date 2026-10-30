/**
 * A 3 by 3 dot grid that says how a job is going. While it works a wave runs
 * across it, corner to corner; when it ends the lit dots draw a tick (done)
 * or a cross (error). Cells are numbered row by row from the top left.
 */
export type LatticeState = "working" | "done" | "error";

export const LATTICE_SIDE = 3;

const CELLS = LATTICE_SIDE * LATTICE_SIDE;

/** . . o / o . o / . o . : a tick drawn in dots. */
const TICK: ReadonlySet<number> = new Set([2, 3, 5, 7]);
/** o . o / . o . / o . o */
const CROSS: ReadonlySet<number> = new Set([0, 2, 4, 6, 8]);

export const latticeCells = (state: LatticeState): readonly boolean[] =>
  Array.from({ length: CELLS }, (_, index) =>
    state === "working" ? true : (state === "done" ? TICK : CROSS).has(index),
  );

/** The wave reaches a dot by its diagonal: row plus column steps. */
export const waveDelayMs = (index: number, stepMs = 110): number =>
  (Math.floor(index / LATTICE_SIDE) + (index % LATTICE_SIDE)) * stepMs;

export const LATTICE_WORDS: Readonly<Record<LatticeState, string>> = {
  working: "Working",
  done: "Done",
  error: "Failed",
};

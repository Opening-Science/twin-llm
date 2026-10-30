/**
 * Self-controlled case series (Farrington 1995, Biometrics 51:228): only
 * people who had the outcome inside counted time, each followed over their
 * whole counted time, and a conditional Poisson model with one parameter per
 * window after exposure onset (before is the reference) and one per age
 * band. Conditioning on the person removes everything fixed about them.
 * Fitted by Newton-Raphson; Wald 95% intervals on the log scale. Pure.
 *
 * An age band with no outcome in it would have no finite estimate, so it is
 * pooled with the next band (the last one with the one before). A window with
 * no outcome, or a fit that does not settle, gives null for that window.
 */
import { type Person } from "../../packages/query-tools/event-rates/cohort";
import { type RateRatio } from "../../packages/query-tools/event-rates/poisson";
import {
  BEFORE,
  personPieces,
  type Piece,
  type TimingSpec,
  windowLabels,
} from "../../packages/query-tools/event-rates/within-person";

export type SccsWindow = Readonly<{ window: string; events: number; ratio: RateRatio }>;

export type SccsResult = Readonly<{
  cases: number;
  eventsBefore: number;
  windows: readonly SccsWindow[];
  /** Age groups after pooling empty bands. */
  ageGroups: number;
  converged: boolean;
}>;

/** Solves A x = b by Gaussian elimination with partial pivoting; null when singular. */
export const solveLinear = (
  matrix: readonly (readonly number[])[],
  rhs: readonly number[],
): number[] | null => {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i] as number]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row]![col]! / a[col]![col]!;
      for (let k = col; k <= n; k += 1) a[row]![k]! -= factor * a[col]![k]!;
    }
  }
  return a.map((row, i) => row[n]! / row[i]!);
};

/** Maps each age band to a group so that every group holds at least one event. */
export const poolBands = (
  eventsByBand: ReadonlyMap<number, number>,
): Map<number, number> => {
  const bands = [...eventsByBand.keys()].sort((x, y) => x - y);
  const groups = new Map<number, number>();
  let group = 0;
  let pending: number[] = [];
  for (const band of bands) {
    pending.push(band);
    if ((eventsByBand.get(band) ?? 0) > 0) {
      for (const b of pending) groups.set(b, group);
      group += 1;
      pending = [];
    }
  }
  // Trailing empty bands join the last group with events.
  for (const b of pending) groups.set(b, Math.max(0, group - 1));
  return groups;
};

type Case = Readonly<{ person: Person; pieces: readonly Piece[] }>;

/**
 * Instead of the observed event, how one expected event spreads over a
 * case's pieces (any non-negative weights; they are scaled to sum to 1).
 * Used by the oracle to fit the model to the events the calculator expects.
 */
export type EventWeights = (
  person: Person,
  pieces: readonly Piece[],
) => readonly number[];

const MAX_STEPS = 60;

export const selfControlledCaseSeries = (
  people: readonly Person[],
  spec: TimingSpec,
  eventWeights?: EventWeights,
): SccsResult => {
  const cases: Case[] = people.flatMap((person) => {
    const pieces = personPieces(person, spec, "case-series");
    return pieces === null || !pieces.some((piece) => piece.event)
      ? []
      : [{ person, pieces }];
  });
  const labels = windowLabels(spec.afterWindowsYears);
  const eventsIn = (window: string) =>
    cases.filter((c) => c.pieces.some((p) => p.event && p.window === window)).length;
  const empty: SccsResult = {
    cases: cases.length,
    eventsBefore: eventsIn(BEFORE),
    windows: labels.map((window) => ({ window, events: eventsIn(window), ratio: null })),
    ageGroups: 0,
    converged: false,
  };
  // With no outcome before onset, every window ratio is unbounded.
  if (cases.length === 0 || empty.eventsBefore === 0) return empty;

  const eventsByBand = new Map<number, number>();
  for (const c of cases) {
    for (const p of c.pieces) {
      eventsByBand.set(p.ageBand, (eventsByBand.get(p.ageBand) ?? 0) + (p.event ? 1 : 0));
    }
  }
  const groupOf = poolBands(eventsByBand);
  const ageGroups = Math.max(...groupOf.values()) + 1;
  // Parameters: one per after window, then one per age group past the first.
  const size = labels.length + ageGroups - 1;
  const features = (piece: Piece): number[] => {
    const x = new Array<number>(size).fill(0);
    const w = labels.indexOf(piece.window);
    if (w >= 0) x[w] = 1;
    const g = groupOf.get(piece.ageBand) ?? 0;
    if (g > 0) x[labels.length + g - 1] = 1;
    return x;
  };
  const expectedEvent = (c: Case, pieces: readonly Piece[]): number[] => {
    const weights = (eventWeights as EventWeights)(c.person, pieces);
    const total = weights.reduce((t, w) => t + w, 0);
    return pieces.reduce(
      (sum, piece, j) =>
        features(piece).map(
          (v, k) => (sum[k] as number) + (v * (weights[j] ?? 0)) / (total || 1),
        ),
      new Array<number>(size).fill(0),
    );
  };
  const prepared = cases.map((c) => {
    const pieces = c.pieces.filter((p) => p.days > 0);
    return {
      rows: pieces.map((p) => ({ x: features(p), days: p.days })),
      event:
        eventWeights === undefined
          ? features(c.pieces.find((p) => p.event) as Piece)
          : expectedEvent(c, pieces),
    };
  });

  // Windows with no events stay at 0 and are reported as null.
  const free = Array.from({ length: size }, (_, k) =>
    k < labels.length ? eventsIn(labels[k] as string) > 0 : true,
  );
  const beta = new Array<number>(size).fill(0);
  let converged = false;
  let information: number[][] = [];
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const gradient = new Array<number>(size).fill(0);
    const hessian = Array.from({ length: size }, () => new Array<number>(size).fill(0));
    for (const c of prepared) {
      const weights = c.rows.map(
        (row) =>
          row.days * Math.exp(row.x.reduce((t, v, k) => t + v * (beta[k] as number), 0)),
      );
      const total = weights.reduce((t, w) => t + w, 0);
      const mu = new Array<number>(size).fill(0);
      c.rows.forEach((row, j) => {
        const p = (weights[j] as number) / total;
        row.x.forEach((v, k) => {
          mu[k] = (mu[k] as number) + p * v;
        });
      });
      for (let k = 0; k < size; k += 1) {
        gradient[k] =
          (gradient[k] as number) + (c.event[k] as number) - (mu[k] as number);
      }
      c.rows.forEach((row, j) => {
        const p = (weights[j] as number) / total;
        for (let k = 0; k < size; k += 1) {
          for (let l = 0; l < size; l += 1) {
            hessian[k]![l]! +=
              p *
              ((row.x[k] as number) - (mu[k] as number)) *
              ((row.x[l] as number) - (mu[l] as number));
          }
        }
      });
    }
    const index = free.flatMap((f, k) => (f ? [k] : []));
    const reduced = index.map((k) => index.map((l) => hessian[k]![l]!));
    const delta = solveLinear(
      reduced,
      index.map((k) => gradient[k] as number),
    );
    if (delta === null) break;
    index.forEach((k, i) => {
      beta[k] = (beta[k] as number) + (delta[i] as number);
    });
    information = reduced;
    if (Math.max(...delta.map(Math.abs)) < 1e-8) {
      converged = true;
      break;
    }
  }
  if (!converged) return { ...empty, ageGroups };

  const index = free.flatMap((f, k) => (f ? [k] : []));
  const variance = (k: number): number | null => {
    const position = index.indexOf(k);
    if (position === -1) return null;
    const unit = index.map((_, i) => (i === position ? 1 : 0));
    const column = solveLinear(information, unit);
    return column === null ? null : (column[position] as number);
  };
  return {
    cases: cases.length,
    eventsBefore: eventsIn(BEFORE),
    windows: labels.map((window, k) => {
      const v = variance(k);
      const b = beta[k] as number;
      if (v === null || v <= 0 || !free[k]) {
        return { window, events: eventsIn(window), ratio: null };
      }
      const se = Math.sqrt(v);
      return {
        window,
        events: eventsIn(window),
        ratio: {
          ratio: Math.exp(b),
          ci: { low: Math.exp(b - 1.959964 * se), high: Math.exp(b + 1.959964 * se) },
        },
      };
    }),
    ageGroups,
    converged,
  };
};

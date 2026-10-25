/**
 * The two statistics the report uses. Pure.
 *
 * Wilson 95 % interval for a pass rate, because n per cell is small and the
 * plain p ± 1.96·se interval leaves [0, 1] there. Percentiles by nearest rank
 * (the smallest value with at least p % of the values at or below it), so a
 * reported p95 is always a latency that was measured.
 */
const Z_95 = 1.959963984540054;

export type Interval = Readonly<{ low: number; high: number }>;

export const wilson95 = (passes: number, n: number): Interval | null => {
  if (n === 0) return null;
  const p = passes / n;
  const z2 = Z_95 * Z_95;
  const centre = p + z2 / (2 * n);
  const spread = Z_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const scale = 1 + z2 / n;
  return {
    low: Math.max(0, (centre - spread) / scale),
    high: Math.min(1, (centre + spread) / scale),
  };
};

export const percentile = (values: readonly number[], p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
};

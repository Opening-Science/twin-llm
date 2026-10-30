/**
 * Pure checks for `verify-source-filter.ts`.
 *
 * HNSW is approximate: even with `hnsw.iterative_scan` a scan only reaches
 * the rows the graph links to, and the graph (random levels, neighbour
 * pruning) differs from build to build. So the probe cannot assert an exact
 * set of ids. It asserts the property that matters: every row has the
 * requested source, ids come from the probe fixture, no row repeats, and the
 * count sits in the expected range (at least one row proves the filtered
 * scan did not come back empty).
 */

export type SourceRow = {
  readonly id: string;
  readonly source: string;
};

export type SourceExpectation = {
  readonly source: string;
  /** Every returned id must pass this test (the probe fixture for that source). */
  readonly isProbeId: (id: string) => boolean;
  readonly min: number;
  readonly max: number;
};

/** First broken property as a message, or null when the rows hold. */
export const checkSourceRows = (
  rows: readonly SourceRow[],
  expect: SourceExpectation,
): string | null => {
  const ids = rows.map((row) => row.id);
  const label = `${expect.source} source returned ${JSON.stringify(ids)}`;
  const foreign = rows.filter((row) => row.source !== expect.source);
  if (foreign.length > 0) {
    return `${label}: rows from ${JSON.stringify([...new Set(foreign.map((row) => row.source))])}`;
  }
  if (ids.some((id) => !expect.isProbeId(id))) return `${label}: id outside the probe`;
  if (new Set(ids).size !== ids.length) return `${label}: duplicate id`;
  if (rows.length < expect.min || rows.length > expect.max) {
    return `${label}: expected ${expect.min} to ${expect.max} rows`;
  }
  return null;
};

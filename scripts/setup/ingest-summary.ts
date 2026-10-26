/** Pure readers for the text other tools print, so setup can report counts. */

export type IngestSummary = Readonly<{
  inserted: number;
  skipped: number;
  rejected: number;
}>;

/** The `Bundles: …` line `warehouse:ingest` prints at the end, or null. */
export const parseIngestSummary = (output: string): IngestSummary | null => {
  const match = /Bundles: (\d+) inserted, (\d+) already ingested, (\d+) rejected/.exec(
    output,
  );
  if (!match) return null;
  return {
    inserted: Number(match[1]),
    skipped: Number(match[2]),
    rejected: Number(match[3]),
  };
};

/** The hash a `SHA256SUMS` file lists for `name`, or null when it lists none. */
export const sha256For = (sums: string, name: string): string | null => {
  for (const line of sums.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match && match[2] === name) return match[1] ?? null;
  }
  return null;
};

/**
 * The Guidelines card's state, pure so the card (a client component) can use
 * it without pulling the database client into the browser bundle. The read
 * lives in `guidelines-status.ts`. Counts only: no titles, no passages.
 */

export type GuidelineCorpusStatus =
  | Readonly<{ state: "ok"; guidelines: number; fullText: number }>
  | Readonly<{ state: "empty" }>
  | Readonly<{ state: "error" }>;

export type IngestModeCount = Readonly<{ ingestMode: string; count: number }>;

export const guidelineStatusFromCounts = (
  rows: readonly IngestModeCount[],
): GuidelineCorpusStatus => {
  const guidelines = rows.reduce((sum, row) => sum + row.count, 0);
  if (guidelines === 0) return { state: "empty" };
  const fullText = rows
    .filter((row) => row.ingestMode === "full_text")
    .reduce((sum, row) => sum + row.count, 0);
  return { state: "ok", guidelines, fullText };
};

/** "10 guidelines indexed · 6 full text" */
export const guidelineDetail = (status: GuidelineCorpusStatus): string | null =>
  status.state === "ok"
    ? `${status.guidelines} ${status.guidelines === 1 ? "guideline" : "guidelines"} indexed · ${status.fullText} full text`
    : null;

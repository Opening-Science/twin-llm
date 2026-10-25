export type GuidelineCitation = {
  readonly tool: string;
  readonly id: string;
  readonly title: string;
  readonly year: number;
  readonly society: string;
  readonly doi: string;
  readonly url: string;
  readonly licence: string;
  readonly ingestMode: string;
  readonly sectionHeading: string | null;
  readonly recommendationId: string | null;
  readonly recClass: string | null;
  readonly evidenceLevel: string | null;
  readonly page: string | null;
};

export type GuidelineTurn = {
  readonly sources: readonly GuidelineCitation[];
};

const turns = new Map<string, { sources: GuidelineCitation[] }>();

export const recordGuidelineTurn = (
  sessionId: string,
  sources: readonly GuidelineCitation[],
): void => {
  const prev = turns.get(sessionId) ?? { sources: [] };
  turns.set(sessionId, { sources: [...prev.sources, ...sources] });
};

export const drainGuidelineTurn = (sessionId: string): GuidelineTurn => {
  const value = turns.get(sessionId);
  turns.delete(sessionId);
  return value ?? { sources: [] };
};

export const resetGuidelineCollectorForTests = (): void => {
  turns.clear();
};

export type KnowledgeCitation = {
  readonly tool: string;
  /** Document id, `opentwin-<file name>`. */
  readonly id: string;
  readonly title: string;
  /** Repo path, e.g. `knowledge/opentwin/metric-glossary.md`. */
  readonly file: string;
  readonly sectionHeading: string;
  readonly licence: string;
};

export type KnowledgeTurn = {
  readonly sources: readonly KnowledgeCitation[];
};

const turns = new Map<string, { sources: KnowledgeCitation[] }>();

export const recordKnowledgeTurn = (
  sessionId: string,
  sources: readonly KnowledgeCitation[],
): void => {
  const prev = turns.get(sessionId) ?? { sources: [] };
  turns.set(sessionId, { sources: [...prev.sources, ...sources] });
};

export const drainKnowledgeTurn = (sessionId: string): KnowledgeTurn => {
  const value = turns.get(sessionId);
  turns.delete(sessionId);
  return value ?? { sources: [] };
};

export const resetKnowledgeCollectorForTests = (): void => {
  turns.clear();
};

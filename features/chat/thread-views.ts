import { type ChatView, viewsOf } from "@/infrastructure/chat-view";
import { toStoredToolParts } from "@/infrastructure/model-response-tool-parts";
import { toResponseDocument } from "@/infrastructure/response-document/parse";

/**
 * The views a thread already has, read back from its stored answers' tool
 * parts: what `list_views` lists and `open_view` reopens. Pure, so the rule
 * is tested with plain rows; `load-thread-views.ts` does the reading.
 *
 * Newest first, each view once (a reopened view counts at its newest
 * showing). An answer the document withholds (abstained or declined) never
 * showed its views, so they are not offered either, as on the thread page.
 */

export type ThreadView = Readonly<{
  view: ChatView;
  modelName: string;
  /** When the answer that showed it finished, ISO 8601; null if unknown. */
  at: string | null;
}>;

export type StoredAnswerRow = Readonly<{
  modelName: string;
  toolParts: unknown;
  responseDocument: unknown;
  completedAt: Date | null;
}>;

const withheld = (row: StoredAnswerRow): boolean => {
  const document = toResponseDocument(row.responseDocument);
  return (
    document?.abstained === true || document?.answer_class === "declined_decision_support"
  );
};

const viewsOfRow = (row: StoredAnswerRow): ThreadView[] =>
  withheld(row)
    ? []
    : viewsOf(
        (toStoredToolParts(row.toolParts) ?? []).map((part) => ({
          type: `tool-${part.tool}`,
          state: "output-available",
          output: part.output,
        })),
      )
        .reverse()
        .map((view) => ({
          view,
          modelName: row.modelName,
          at: row.completedAt?.toISOString() ?? null,
        }));

const newestFirst = (a: StoredAnswerRow, b: StoredAnswerRow): number =>
  (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0);

export const threadViewsOf = (rows: readonly StoredAnswerRow[]): ThreadView[] => {
  const all = [...rows].sort(newestFirst).flatMap(viewsOfRow);
  return all.filter(
    (entry, index) => all.findIndex((other) => other.view.id === entry.view.id) === index,
  );
};

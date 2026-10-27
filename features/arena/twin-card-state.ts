import type { TurnState } from "./conversation";

/**
 * The `/twin` card's place and state in a conversation. It is a view item
 * beside the turns, never a turn: `historyFor` only ever sees `turns`, so the
 * card never reaches a model.
 *
 * The card sits where it was opened, after the turns there were then. A
 * second `/twin` reopens the same card rather than adding another. Its state
 * is kept per thread in sessionStorage, never in the database.
 */

export type TwinCard = Readonly<{
  /** How many turns the thread had when the card was opened; it sits after them. */
  afterTurns: number;
  collapsed: boolean;
}>;

export type TwinCardAction =
  | Readonly<{ type: "open"; turnCount: number }>
  | Readonly<{ type: "collapse" }>
  | Readonly<{ type: "expand" }>
  | Readonly<{ type: "close" }>
  | Readonly<{ type: "restore"; card: TwinCard | null }>;

export const twinCardReducer = (
  card: TwinCard | null,
  action: TwinCardAction,
): TwinCard | null => {
  switch (action.type) {
    case "open":
      return card === null
        ? { afterTurns: action.turnCount, collapsed: false }
        : { ...card, collapsed: false };
    case "collapse":
      return card === null ? null : { ...card, collapsed: true };
    case "expand":
      return card === null ? null : { ...card, collapsed: false };
    case "close":
      return null;
    case "restore":
      return action.card;
  }
};

export type ConversationItem =
  | Readonly<{ kind: "turn"; turn: TurnState; index: number }>
  | Readonly<{ kind: "twin"; card: TwinCard }>;

/** The turns in order, with the card after the turns it was opened after. */
export const conversationItems = (
  turns: readonly TurnState[],
  card: TwinCard | null,
): readonly ConversationItem[] => {
  const items: readonly ConversationItem[] = turns.map((turn, index) => ({
    kind: "turn",
    turn,
    index,
  }));
  if (card === null) return items;
  const at = Math.min(Math.max(card.afterTurns, 0), turns.length);
  return [...items.slice(0, at), { kind: "twin", card }, ...items.slice(at)];
};

type ReadStore = Pick<Storage, "getItem">;
type WriteStore = Pick<Storage, "setItem" | "removeItem">;

export const twinCardKey = (threadId: string): string => `twinllm:twin-card:${threadId}`;

const isCard = (value: unknown): value is TwinCard => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.afterTurns === "number" &&
    Number.isInteger(record.afterTurns) &&
    record.afterTurns >= 0 &&
    typeof record.collapsed === "boolean"
  );
};

/** The saved card of a thread; null when there is none, storage is blocked or the value is not ours. */
export const readTwinCard = (
  store: () => ReadStore | null,
  threadId: string,
): TwinCard | null => {
  try {
    const raw = store()?.getItem(twinCardKey(threadId));
    if (raw == null) return null;
    const value: unknown = JSON.parse(raw);
    return isCard(value)
      ? { afterTurns: value.afterTurns, collapsed: value.collapsed }
      : null;
  } catch {
    return null;
  }
};

/** Saves the card, or forgets it once closed. A blocked storage only means it is not remembered. */
export const writeTwinCard = (
  store: () => WriteStore | null,
  threadId: string,
  card: TwinCard | null,
): void => {
  try {
    const target = store();
    if (target === null) return;
    if (card === null) target.removeItem(twinCardKey(threadId));
    else target.setItem(twinCardKey(threadId), JSON.stringify(card));
  } catch {
    // Private windows and blocked site data throw; the card still works this visit.
  }
};

import { describe, expect, test } from "bun:test";

import type { ResponseState, TurnState } from "./conversation";
import { historyFor } from "./turn-history";
import {
  conversationItems,
  readTwinCard,
  twinCardKey,
  twinCardReducer,
  writeTwinCard,
} from "./twin-card-state";

const answer = (modelId: string, text: string): ResponseState => ({
  id: `${modelId}-response`,
  modelId,
  modelName: modelId,
  status: "COMPLETE",
  text,
  metrics: null,
});

const turns: readonly TurnState[] = [
  { id: "turn-1", prompt: "Synthetic question one", answers: [answer("m", "One")] },
  { id: "turn-2", prompt: "Synthetic question two", answers: [answer("m", "Two")] },
];

describe("twinCardReducer", () => {
  test("opens after the turns there are, collapses, expands and closes", () => {
    const opened = twinCardReducer(null, { type: "open", turnCount: 2 });
    expect(opened).toEqual({ afterTurns: 2, collapsed: false });
    const collapsed = twinCardReducer(opened, { type: "collapse" });
    expect(collapsed).toEqual({ afterTurns: 2, collapsed: true });
    expect(twinCardReducer(collapsed, { type: "expand" })).toEqual({
      afterTurns: 2,
      collapsed: false,
    });
    expect(twinCardReducer(collapsed, { type: "close" })).toBeNull();
  });

  test("a second /twin reopens the same card where it is instead of adding one", () => {
    const collapsed = { afterTurns: 1, collapsed: true };
    expect(twinCardReducer(collapsed, { type: "open", turnCount: 5 })).toEqual({
      afterTurns: 1,
      collapsed: false,
    });
  });

  test("collapse and expand do nothing without a card", () => {
    expect(twinCardReducer(null, { type: "collapse" })).toBeNull();
    expect(twinCardReducer(null, { type: "expand" })).toBeNull();
  });
});

describe("conversationItems", () => {
  test("the card sits after the turns it was opened after, once", () => {
    const card = { afterTurns: 1, collapsed: false };
    expect(
      conversationItems(turns, card).map((item) =>
        item.kind === "turn" ? item.turn.id : "twin",
      ),
    ).toEqual(["turn-1", "twin", "turn-2"]);
  });

  test("opened on an empty thread it comes first; a stale position clamps to the end", () => {
    expect(
      conversationItems([], { afterTurns: 0, collapsed: true }).map((item) => item.kind),
    ).toEqual(["twin"]);
    expect(
      conversationItems(turns, { afterTurns: 9, collapsed: false }).map((item) =>
        item.kind === "turn" ? item.turn.id : "twin",
      ),
    ).toEqual(["turn-1", "turn-2", "twin"]);
  });

  test("with no card the items are the turns", () => {
    expect(conversationItems(turns, null).map((item) => item.kind)).toEqual([
      "turn",
      "turn",
    ]);
  });
});

describe("the card never reaches a model", () => {
  test("history for the next turn holds the prompts and answers only", () => {
    const card = twinCardReducer(null, { type: "open", turnCount: 1 });
    const items = conversationItems(turns, card);
    expect(items.map((item) => item.kind)).toEqual(["turn", "twin", "turn"]);
    // The conversation hook builds each request from `turns`; the card is not one.
    expect(historyFor(turns, 1, "m")).toEqual([
      { role: "user", content: "Synthetic question one" },
      { role: "assistant", content: "One" },
      { role: "user", content: "Synthetic question two" },
    ]);
  });
});

const memoryStore = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
};

const throwing = {
  getItem: (): string | null => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("sessionStorage", () => {
  test("keeps the card per thread and forgets it once closed", () => {
    const store = memoryStore();
    writeTwinCard(() => store, "thread-a", { afterTurns: 2, collapsed: true });
    expect(store.values.get(twinCardKey("thread-a"))).toBe(
      '{"afterTurns":2,"collapsed":true}',
    );
    expect(readTwinCard(() => store, "thread-a")).toEqual({
      afterTurns: 2,
      collapsed: true,
    });
    expect(readTwinCard(() => store, "thread-b")).toBeNull();
    writeTwinCard(() => store, "thread-a", null);
    expect(store.values.size).toBe(0);
  });

  test("blocked storage, no window and foreign values read as no card", () => {
    expect(readTwinCard(() => throwing, "thread-a")).toBeNull();
    expect(readTwinCard(() => null, "thread-a")).toBeNull();
    expect(() =>
      writeTwinCard(() => throwing, "thread-a", { afterTurns: 0, collapsed: false }),
    ).not.toThrow();
    const store = memoryStore();
    store.setItem(twinCardKey("thread-a"), "{not json");
    expect(readTwinCard(() => store, "thread-a")).toBeNull();
    store.setItem(twinCardKey("thread-a"), '{"afterTurns":-1,"collapsed":false}');
    expect(readTwinCard(() => store, "thread-a")).toBeNull();
    expect(() =>
      readTwinCard(() => {
        throw new Error("SecurityError");
      }, "thread-a"),
    ).not.toThrow();
  });
});

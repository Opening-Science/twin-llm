import { describe, expect, test } from "bun:test";

import { CHAT_SEAL_CONTEXTS } from "@/infrastructure/chat-seal-contexts";
import { PERSONAL_TABLES } from "@/infrastructure/personal-columns";

import { CHAT_MOVES } from "./tables";

describe("frozen seal contexts and the column map", () => {
  test("each sealed column of a new table is sealed under the column it was copied from", () => {
    const fromMap = CHAT_MOVES.flatMap((move) =>
      move.columns
        .filter((column) => column.to.endsWith("_sealed"))
        .map((column) => [move.to, column.to, move.from, column.from]),
    );
    const fromContexts = Object.entries(CHAT_SEAL_CONTEXTS).flatMap(([table, columns]) =>
      Object.entries(columns).map(([column, context]) => [
        table,
        column,
        context.table,
        context.column,
      ]),
    );
    expect(fromContexts).toEqual(fromMap);
  });

  test("the contexts are exactly the columns the reseal list seals today", () => {
    const sealedToday = PERSONAL_TABLES.filter((table) =>
      ["threads", "turns", "model_responses"].includes(table.table),
    ).flatMap((table) => table.sealed.map((column) => `${table.table}.${column}`));
    const frozen = Object.values(CHAT_SEAL_CONTEXTS).flatMap((columns) =>
      Object.values(columns).map((context) => `${context.table}.${context.column}`),
    );
    expect(frozen.sort()).toEqual(sealedToday.sort());
  });
});

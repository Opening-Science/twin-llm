import { describe, expect, test } from "bun:test";

import { Prisma } from "@/generated/prisma/client";

import {
  ANSWERS,
  CHAT_MOVES,
  CONVERSATIONS,
  EXCHANGES,
  type TableMove,
  valueOf,
} from "./tables";

const snake = (name: string): string =>
  name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const cases: readonly (readonly [TableMove, readonly string[], readonly string[]])[] = [
  [
    CONVERSATIONS,
    Object.values(Prisma.ThreadScalarFieldEnum),
    Object.values(Prisma.ConversationScalarFieldEnum),
  ],
  [
    EXCHANGES,
    Object.values(Prisma.TurnScalarFieldEnum),
    Object.values(Prisma.ExchangeScalarFieldEnum),
  ],
  [
    ANSWERS,
    Object.values(Prisma.ModelResponseScalarFieldEnum),
    Object.values(Prisma.AnswerScalarFieldEnum),
  ],
];

describe("chat table map", () => {
  for (const [move, oldFields, newFields] of cases) {
    test(`${move.from}: every old column is copied exactly once`, () => {
      expect(move.columns.map((column) => column.from).sort()).toEqual(
        [...oldFields].sort(),
      );
    });

    test(`${move.to}: every new column is filled once or listed as added`, () => {
      const filled = [...move.columns.map((column) => column.to), ...move.added];
      expect(new Set(filled).size).toBe(filled.length);
      expect(filled.sort()).toEqual(newFields.map(snake).sort());
    });

    test(`${move.to}: the id is kept`, () => {
      expect(move.columns[0]).toEqual({ from: "id", to: "id", kind: "copy" });
    });
  }

  test("parents are copied before their children", () => {
    expect(CHAT_MOVES.map((move) => move.to)).toEqual([
      "conversations",
      "exchanges",
      "answers",
    ]);
  });

  test("every sealed column is copied as stored, never transformed", () => {
    const sealed = CHAT_MOVES.flatMap((move) =>
      move.columns.filter((column) => column.to.endsWith("_sealed")),
    );
    expect(sealed.map((column) => column.from)).toEqual([
      "title",
      "prompt",
      "label",
      "text",
      "reasoningText",
      "attribution",
      "responseDocument",
      "toolParts",
    ]);
    expect(sealed.every((column) => column.kind === "copy")).toBe(true);
  });

  test("values are read from the named row", () => {
    expect(valueOf("NEW", { from: "createdAt", to: "asked_at", kind: "utc" })).toBe(
      `(NEW."createdAt" AT TIME ZONE 'UTC')`,
    );
    expect(valueOf("t", { from: "scheduled", to: "origin", kind: "origin" })).toBe(
      `(CASE WHEN t."scheduled" THEN 'schedule' ELSE 'person' END)::"exchange_origin"`,
    );
    expect(valueOf("r", { from: "status", to: "state", kind: "state" })).toBe(
      `lower(r."status"::text)::"answer_state"`,
    );
  });
});

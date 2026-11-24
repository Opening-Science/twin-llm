import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  asBeforeSwitch,
  asSwitched,
  columnShapes,
  liveDatabase,
  runLive,
} from "./live.test-helpers";
import { CHAT_MOVES, type ColumnCopy } from "./tables";

/**
 * The expand migration against a real Postgres: every new column can hold
 * exactly what its old column holds (same type, precision and nullability),
 * so the copy cannot truncate, round or reject a value.
 *   RUN_LIVE=1 DATABASE_URL=<throwaway, migrated> bun test scripts/db/chat-move/expand.live.test.ts
 */

const expectedType = (column: ColumnCopy, oldType: string): string => {
  switch (column.kind) {
    case "copy":
      return oldType;
    case "utc":
      return "timestamp with time zone";
    case "origin":
      return "exchange_origin";
    case "state":
      return "answer_state";
  }
};

describe.skipIf(!runLive)("chat tables after the expand migration (RUN_LIVE=1)", () => {
  const db = liveDatabase();
  beforeAll(() => asBeforeSwitch(db));
  afterAll(async () => {
    await asSwitched(db);
    await db.$disconnect();
  });

  test("each new column holds what its old column holds", async () => {
    const mismatches: string[] = [];
    for (const move of CHAT_MOVES) {
      const before = await columnShapes(db, move.from);
      const after = await columnShapes(db, move.to);
      expect(after.size).toBe(move.columns.length + move.added.length);
      for (const column of move.columns) {
        const old = before.get(column.from);
        const now = after.get(column.to);
        if (old === undefined || now === undefined) {
          mismatches.push(`${move.to}.${column.to}: missing`);
          continue;
        }
        const want = {
          type: expectedType(column, old.type),
          nullable: old.nullable,
          precision: old.precision,
          scale: old.scale,
        };
        const got = {
          type: now.type,
          nullable: now.nullable,
          precision: now.precision,
          scale: now.scale,
        };
        if (JSON.stringify(want) !== JSON.stringify(got)) {
          mismatches.push(`${move.to}.${column.to}: ${JSON.stringify(got)}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  test("the old status values and the new states match one to one", async () => {
    const labels = async (type: string) =>
      (
        await db.$queryRaw<{ label: string }[]>`
          SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = ${type} ORDER BY e.enumsortorder`
      ).map((row) => row.label);
    const statuses = await labels("model_response_status");
    expect(statuses.map((status) => status.toLowerCase())).toEqual(
      await labels("answer_state"),
    );
  });

  test("the chat move is marked in progress, and only a known phase is accepted", async () => {
    const marker = await db.schemaMove.findUnique({ where: { move: "chat-tables" } });
    expect(["expanded", "backfilled"]).toContain(marker?.phase ?? "missing");
    const unknownPhase = await db.schemaMove
      .update({ where: { move: "chat-tables" }, data: { phase: "switched" } })
      .then(
        () => "accepted",
        () => "refused",
      );
    expect(unknownPhase).toBe("refused");
  });

  test("the new tables have no foreign keys yet", async () => {
    const keys = await db.$queryRaw<{ name: string }[]>`
      SELECT conname AS name FROM pg_constraint
       WHERE contype = 'f'
         AND conrelid::regclass::text IN ('conversations', 'exchanges', 'answers')`;
    expect(keys).toEqual([]);
  });
});

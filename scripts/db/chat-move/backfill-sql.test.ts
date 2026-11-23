import { describe, expect, test } from "bun:test";

import { batchSizeOf } from "./backfill";
import {
  addConstraintSql,
  batchSql,
  FINISH_CONSTRAINTS,
  UNDO_FINISH_SQL,
} from "./backfill-sql";
import { ANSWERS, CHAT_MOVES, EXCHANGES } from "./tables";

describe("chat backfill SQL", () => {
  test("each batch locks the old rows it reads and never overwrites a copy", () => {
    for (const move of CHAT_MOVES) {
      const sql = batchSql(move);
      expect(sql).toContain(`FROM "${move.from}" o`);
      expect(sql).toContain('ORDER BY o."id"');
      expect(sql).toContain(`WHERE o."id" > coalesce($1::text, '')`);
      expect(sql).toContain("FOR SHARE");
      expect(sql).toContain(`INSERT INTO "${move.to}"`);
      expect(sql).toContain(`ON CONFLICT ("id") DO NOTHING`);
      expect(sql).not.toContain("DO UPDATE");
    }
  });

  test("only exchanges get a schedule, and only from a scheduled turn", () => {
    expect(batchSql(EXCHANGES)).toContain(`"schedule_id"`);
    expect(batchSql(EXCHANGES)).toContain(`CASE WHEN o."scheduled" THEN`);
    expect(batchSql(ANSWERS)).not.toContain("schedule_id");
  });

  test("constraints are added unchecked first, and undo drops every one", () => {
    for (const constraint of FINISH_CONSTRAINTS) {
      expect(addConstraintSql(constraint)).toContain("NOT VALID");
      expect(UNDO_FINISH_SQL).toContain(
        `ALTER TABLE "${constraint.table}" DROP CONSTRAINT IF EXISTS "${constraint.name}"`,
      );
    }
  });

  test("a deleted task clears the schedule, as the plan says", () => {
    const schedule = FINISH_CONSTRAINTS.find(
      (constraint) => constraint.name === "exchanges_schedule_id_fkey",
    );
    expect(schedule?.definition).toContain("ON DELETE SET NULL");
  });

  test("the batch size is a whole number from 1 to 10,000", () => {
    expect(batchSizeOf([])).toBe(1000);
    expect(batchSizeOf(["--batch-size=250"])).toBe(250);
    expect(batchSizeOf(["--batch-size=0"])).toBeNull();
    expect(batchSizeOf(["--batch-size=1.5"])).toBeNull();
    expect(batchSizeOf(["--batch-size=10001"])).toBeNull();
    expect(batchSizeOf(["--batch-size=lots"])).toBeNull();
  });
});

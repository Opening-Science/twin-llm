import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { FINISH_CONSTRAINTS } from "./backfill-sql";
import { MIRROR_SQL } from "./mirror-sql";
import {
  DROP_REVERSE_SQL,
  FORGET_SWITCH_SQL,
  REPOINTED_KEYS,
  REVERSE_SQL,
  reverseValueOf,
  SWITCH_BACK_SQL,
  SWITCH_MIGRATION,
  SWITCH_SQL,
  switchMigrationBody,
} from "./switch-sql";
import { CHAT_MOVES } from "./tables";

const MIGRATIONS = join(import.meta.dir, "../../../prisma/migrations");

const MIRRORED = ["threads", "turns", "model_responses", "scheduled_tasks"];

describe("chat tables switch SQL", () => {
  test("the migration holds exactly the generated switch", async () => {
    const text = await Bun.file(
      join(MIGRATIONS, SWITCH_MIGRATION, "migration.sql"),
    ).text();
    expect(text.replace(/^(--.*\n)+\n/, "")).toBe(switchMigrationBody());
  });

  test("the switch comes after the expand, marker and mirror migrations", async () => {
    const names = (
      await Array.fromAsync(new Bun.Glob("*/migration.sql").scan(MIGRATIONS))
    )
      .map((path) => path.split("/")[0] ?? "")
      .sort();
    expect(names.at(-1)).toBe(SWITCH_MIGRATION);
    expect(names).toContain("20261118120200_chat_tables_mirror");
  });

  test("each SQL item is one statement, so the scripts can run them one by one", () => {
    for (const statement of [...SWITCH_SQL, ...SWITCH_BACK_SQL]) {
      const outsideBodies = statement.replace(/\$\$[\s\S]*?\$\$/g, "$$$$");
      expect(outsideBodies.trim().replace(/;$/, "")).not.toContain(";");
    }
  });

  test("the switch locks, checks, then drops every mirror trigger and adds every reverse one", () => {
    expect(SWITCH_SQL[0]).toStartWith("LOCK TABLE");
    expect(SWITCH_SQL[1]).toContain("RAISE EXCEPTION");
    for (const table of MIRRORED) {
      expect(SWITCH_SQL).toContain(
        `DROP TRIGGER IF EXISTS "chat_move_mirror" ON "${table}";`,
      );
    }
    for (const move of CHAT_MOVES) {
      expect(REVERSE_SQL).toContain(`ON "${move.to}"\n  FOR EACH ROW`);
      expect(DROP_REVERSE_SQL).toContain(
        `DROP TRIGGER IF EXISTS "chat_move_reverse" ON "${move.to}";`,
      );
    }
    expect(SWITCH_SQL.at(-1)).toContain(`SET "phase" = 'switched'`);
  });

  test("the switch adds any missing key of the new tables before it swaps", () => {
    const firstDrop = SWITCH_SQL.findIndex((s) => s.includes("chat_move_mirror"));
    for (const constraint of FINISH_CONSTRAINTS) {
      const added = SWITCH_SQL.findIndex((s) => s.includes(`'${constraint.name}'`));
      expect(added).toBeGreaterThan(1);
      expect(added).toBeLessThan(firstDrop);
    }
  });

  test("every mapped column is copied back, and changes on the way only as the mirror's inverse", () => {
    for (const move of CHAT_MOVES) {
      for (const column of move.columns) {
        expect(REVERSE_SQL).toContain(`"${column.from}"`);
        expect(REVERSE_SQL).toContain(reverseValueOf(column));
      }
    }
    expect(REVERSE_SQL).toContain(`(NEW."asked_at" AT TIME ZONE 'UTC')`);
    expect(REVERSE_SQL).toContain(`(NEW."origin" = 'schedule')`);
    expect(REVERSE_SQL).toContain(`upper(NEW."state"::text)::"model_response_status"`);
    // Only the old row is written: never a new table, so a write cannot bounce back.
    expect(REVERSE_SQL).not.toMatch(/INSERT INTO "(conversations|exchanges|answers)"/);
  });

  test("both keys move to conversations, and back to threads", () => {
    for (const key of REPOINTED_KEYS) {
      expect(SWITCH_SQL.join("\n")).toContain(
        `ALTER TABLE "${key.table}" ADD CONSTRAINT "${key.name}" FOREIGN KEY ("thread_id") REFERENCES "conversations"("id")`,
      );
      expect(SWITCH_BACK_SQL.join("\n")).toContain(
        `ALTER TABLE "${key.table}" ADD CONSTRAINT "${key.name}" FOREIGN KEY ("thread_id") REFERENCES "threads"("id")`,
      );
    }
  });

  test("switching back drops the reverse triggers, restores the mirror exactly, and forgets the switch last", () => {
    expect(SWITCH_BACK_SQL[0]).toStartWith("LOCK TABLE");
    expect(SWITCH_BACK_SQL.join("\n\n")).toContain(MIRROR_SQL);
    for (const line of DROP_REVERSE_SQL.split("\n"))
      expect(SWITCH_BACK_SQL).toContain(line);
    expect(SWITCH_BACK_SQL).toContain(
      `UPDATE "schema_moves" SET "phase" = 'backfilled', "updated_at" = CURRENT_TIMESTAMP WHERE "move" = 'chat-tables';`,
    );
    expect(SWITCH_BACK_SQL.at(-1)).toBe(FORGET_SWITCH_SQL);
    expect(FORGET_SWITCH_SQL).toBe(
      `DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261124120000_chat_tables_switch';`,
    );
  });

  test("switching back never deletes or drops a chat row or table", () => {
    for (const statement of SWITCH_BACK_SQL.filter((s) => s !== FORGET_SWITCH_SQL)) {
      expect(statement).not.toMatch(/^(DROP TABLE|DELETE|TRUNCATE)/);
      if (!statement.startsWith("CREATE FUNCTION")) {
        expect(statement).not.toMatch(/\bDELETE FROM\b/);
      }
    }
  });
});

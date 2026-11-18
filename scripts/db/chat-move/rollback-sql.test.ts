import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  FORGET_MIGRATIONS_SQL,
  ROLLBACK_SQL,
  ROLLED_BACK_MIGRATIONS,
} from "./rollback-sql";

const MIGRATIONS = join(import.meta.dir, "../../../prisma/migrations");

const created = async (): Promise<readonly string[]> => {
  const names: string[] = [];
  for (const migration of ROLLED_BACK_MIGRATIONS) {
    const sql = await Bun.file(join(MIGRATIONS, migration, "migration.sql")).text();
    for (const match of sql.matchAll(
      /CREATE (TABLE|TYPE|FUNCTION|TRIGGER) "([^"]+)"(?:[^\n]*\bON "([^"]+)")?/g,
    )) {
      const [, kind, name, table] = match;
      names.push(kind === "TRIGGER" ? `TRIGGER ${name} ON ${table}` : `${kind} ${name}`);
    }
  }
  return names;
};

describe("chat move rollback SQL", () => {
  test("names migrations that exist", async () => {
    for (const migration of ROLLED_BACK_MIGRATIONS) {
      expect(await Bun.file(join(MIGRATIONS, migration, "migration.sql")).exists()).toBe(
        true,
      );
    }
  });

  test("drops everything those migrations create, and nothing else", async () => {
    const drops = ROLLBACK_SQL.filter((statement) => statement !== FORGET_MIGRATIONS_SQL);
    const dropped = drops.map((statement) =>
      statement
        .replace(/;$/, "")
        .replace(/^DROP (TABLE|TYPE) IF EXISTS "([^"]+)"$/, "$1 $2")
        .replace(/^DROP FUNCTION IF EXISTS "([^"]+)"\(\)$/, "FUNCTION $1")
        .replace(/^DROP TRIGGER IF EXISTS "([^"]+)" ON "([^"]+)"$/, "TRIGGER $1 ON $2"),
    );
    expect([...dropped].sort()).toEqual([...(await created())].sort());
  });

  test("forgets exactly the three migrations, last, so a deploy applies them again", () => {
    expect(ROLLBACK_SQL.at(-1)).toBe(
      `DELETE FROM "_prisma_migrations" WHERE "migration_name" IN ('20261118120200_chat_tables_mirror', '20261118120100_schema_moves', '20261118120000_chat_tables_expand')`,
    );
  });

  test("never touches the old chat tables", () => {
    for (const statement of ROLLBACK_SQL.filter((s) => s !== FORGET_MIGRATIONS_SQL)) {
      expect(statement).not.toMatch(
        /^DROP TABLE IF EXISTS "(threads|turns|model_responses)"/,
      );
      expect(statement).not.toMatch(/\b(DELETE|UPDATE|TRUNCATE)\b/);
    }
  });
});

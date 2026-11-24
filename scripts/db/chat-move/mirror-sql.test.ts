import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { AnswerState, ModelResponseStatus } from "@/generated/prisma/client";

import { DROP_MIRROR_SQL, MIRROR_SQL } from "./mirror-sql";

const MIGRATION = join(
  import.meta.dir,
  "../../../prisma/migrations/20261118120200_chat_tables_mirror/migration.sql",
);

describe("mirror trigger SQL", () => {
  test("the migration holds exactly the generated triggers", async () => {
    const text = await Bun.file(MIGRATION).text();
    const body = text.replace(/^(--.*\n)+\n/, "");
    expect(body).toBe(`${MIRROR_SQL}\n`);
  });

  test("one trigger per mirrored table, and the rollback drops each", () => {
    for (const table of ["threads", "turns", "model_responses", "scheduled_tasks"]) {
      expect(MIRROR_SQL).toContain(`ON "${table}"\n  FOR EACH ROW`);
      expect(DROP_MIRROR_SQL).toContain(
        `DROP TRIGGER IF EXISTS "chat_move_mirror" ON "${table}";`,
      );
    }
  });

  test("sealed columns are copied from the new row as stored", () => {
    for (const [from, to] of [
      ["title", "title_sealed"],
      ["prompt", "question_sealed"],
      ["text", "body_sealed"],
      ["toolParts", "tool_trace_sealed"],
    ]) {
      expect(MIRROR_SQL).toContain(`NEW."${from}"`);
      expect(MIRROR_SQL).toContain(`"${to}" = EXCLUDED."${to}"`);
    }
  });

  test("every old status has its state, so the answers trigger never refuses a write", () => {
    // The trigger casts lower(status) to answer_state inside the app's own
    // write: a status with no state would fail every answer, not only its copy.
    expect(
      Object.values(ModelResponseStatus).map((status) => status.toLowerCase()),
    ).toEqual(Object.values(AnswerState));
  });
});

import { describe, expect, test } from "bun:test";

import { reportLines } from "./parity";
import { countsSql, differencesSql, ORPHAN_CHECKS, sealedPairsSql } from "./parity-sql";
import { ANSWERS, CHAT_MOVES } from "./tables";

const WRITES = /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/i;

describe("chat parity SQL", () => {
  test("every query of the gate only reads", () => {
    const all = [
      ...CHAT_MOVES.flatMap((move) => [
        countsSql(move),
        differencesSql(move),
        ...move.columns.map((column) => sealedPairsSql(move, column)),
      ]),
      ...ORPHAN_CHECKS.map((check) => check.sql),
    ];
    for (const sql of all) {
      expect(sql.trimStart().startsWith("SELECT") || sql.startsWith("WITH")).toBe(true);
      expect(sql).not.toMatch(WRITES);
    }
  });

  test("a row differs when any mapped column differs, nulls included", () => {
    const sql = countsSql(ANSWERS);
    expect(sql).toContain("IS DISTINCT FROM");
    for (const column of ANSWERS.columns) {
      expect(sql).toContain(`n."${column.to}"`);
    }
  });

  test("the report says OK only when every count is right", () => {
    const table = {
      table: "answers",
      oldRows: 2,
      newRows: 2,
      missing: 0,
      extra: 0,
      differing: 0,
    };
    expect(reportLines({ tables: [table], orphans: { x: 0 }, ok: true }).at(-1)).toBe(
      "parity OK",
    );
    expect(
      reportLines({ tables: [{ ...table, differing: 1 }], orphans: { x: 0 }, ok: false }),
    ).toEqual([
      "answers: 2 old, 2 new, 0 missing, 0 extra, 1 differing",
      "x: 0",
      "parity FAIL",
    ]);
  });
});

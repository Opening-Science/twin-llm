import { describe, expect, test } from "bun:test";

import { bundleSetSha256 } from "./cohort-fingerprint";
import {
  cohortDeleteStatements,
  deleteCohortRows,
  formatDeleted,
  ReloadRefusedError,
  WAREHOUSE_TABLES,
} from "./cohort-reload";
import { type SqlClient, type SqlQuery } from "./detect";

type Call = Readonly<{ query: string; params: readonly unknown[] }>;

/**
 * A fake Postgres that answers the reload's queries from a script: the
 * "other cohorts" counts before and after, the rows each delete removed, and
 * what is left. It records every query and whether the transaction committed.
 */
const fakeSql = (
  answers: Readonly<{ before: string; after: string; left: number; deleted: number }>,
) => {
  const calls: Call[] = [];
  const state = { committed: false, rolledBack: false, closed: false };
  let otherCounts = 0;
  const tx: SqlQuery = {
    unsafe: async (query, params = []) => {
      calls.push({ query, params });
      if (query.includes("cohort_id <> $1")) {
        otherCounts += 1;
        const [subjects, bundles] = (
          otherCounts === 1 ? answers.before : answers.after
        ).split("/");
        return [{ subjects, bundles }];
      }
      if (query.includes("left_rows")) return [{ left_rows: answers.left }];
      return [{ n: answers.deleted }];
    },
  };
  const sql: SqlClient = {
    unsafe: tx.unsafe,
    begin: async (work) => {
      try {
        const result = await work(tx);
        state.committed = true;
        return result;
      } catch (error) {
        state.rolledBack = true;
        throw error;
      }
    },
    close: async () => {
      state.closed = true;
    },
  };
  return { sql, calls, state };
};

describe("cohortDeleteStatements", () => {
  test("touches only the warehouse tables, each scoped by the cohort id as $1", () => {
    const statements = cohortDeleteStatements();
    expect(statements.map((statement) => statement.table)).toEqual([...WAREHOUSE_TABLES]);
    for (const statement of statements) {
      expect(statement.sql.startsWith(`delete from ${statement.table} where `)).toBe(
        true,
      );
      // Every cohort filter is the bound parameter, never a literal or a bare delete.
      expect(statement.sql.match(/cohort_id = \$1/g)?.length).toBe(
        statement.table === "bundles" || statement.table === "subjects" ? 1 : 2,
      );
      expect(statement.sql.match(/cohort_id/g)?.length).toBe(
        statement.sql.match(/cohort_id = \$1/g)?.length,
      );
    }
  });
});

describe("deleteCohortRows", () => {
  test("deletes in one transaction and reports what each table lost", async () => {
    const db = fakeSql({ before: "3/3", after: "3/3", left: 0, deleted: 7 });
    expect(await deleteCohortRows(db.sql, "synthea-v4-seed42")).toEqual({
      observations: 7,
      observation_non_numeric: 7,
      bundles: 7,
      subjects: 7,
    });
    expect(db.state).toEqual({ committed: true, rolledBack: false, closed: false });
    expect(db.calls.every((call) => call.params[0] === "synthea-v4-seed42")).toBe(true);
    expect(db.calls.filter((call) => call.query.includes("delete from")).length).toBe(4);
  });

  test("deletes the trimmed fixtures' cohort the same way, scoped by its id (#96)", async () => {
    const db = fakeSql({ before: "37/37", after: "37/37", left: 0, deleted: 3 });
    expect(await deleteCohortRows(db.sql, "open-twin-synthea-trimmed-3")).toEqual({
      observations: 3,
      observation_non_numeric: 3,
      bundles: 3,
      subjects: 3,
    });
    expect(db.state).toEqual({ committed: true, rolledBack: false, closed: false });
    expect(
      db.calls.every((call) => call.params[0] === "open-twin-synthea-trimmed-3"),
    ).toBe(true);
  });

  test("refuses any cohort but the evaluation cohort and the fixtures before touching the database", async () => {
    const db = fakeSql({ before: "0/0", after: "0/0", left: 0, deleted: 0 });
    await expect(deleteCohortRows(db.sql, "synthea-v4-seed42-10k")).rejects.toThrow(
      new ReloadRefusedError(
        "refusing to delete cohort synthea-v4-seed42-10k: only synthea-v4-seed42 and open-twin-synthea-trimmed-3 can be deleted",
      ),
    );
    expect(db.calls).toEqual([]);
  });

  test("rolls back when another cohort's counts moved", async () => {
    const db = fakeSql({ before: "3/3", after: "2/3", left: 0, deleted: 1 });
    await expect(deleteCohortRows(db.sql, "synthea-v4-seed42")).rejects.toThrow(
      "other cohorts' rows changed during the delete (3/3 subjects/bundles before, 2/3 after); rolled back, nothing deleted",
    );
    expect(db.state.rolledBack).toBe(true);
    expect(db.state.committed).toBe(false);
  });

  test("rolls back when rows of the cohort are left", async () => {
    const db = fakeSql({ before: "0/0", after: "0/0", left: 2, deleted: 1 });
    await expect(deleteCohortRows(db.sql, "synthea-v4-seed42")).rejects.toThrow(
      "synthea-v4-seed42 still has rows after the delete; rolled back, nothing deleted",
    );
    expect(db.state.rolledBack).toBe(true);
  });
});

describe("formatDeleted", () => {
  test("one line", () => {
    expect(
      formatDeleted("synthea-v4-seed42", {
        observations: 10,
        observation_non_numeric: 4,
        bundles: 35,
        subjects: 35,
      }),
    ).toBe(
      "synthea-v4-seed42: deleted 35 subjects, 35 bundles, 10 observations and 4 non-numeric observations",
    );
  });
});

describe("bundleSetSha256", () => {
  test("is the hash of the sorted hashes, one per line, independent of order", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    expect(bundleSetSha256([b, a])).toBe(bundleSetSha256([a, b]));
    expect(bundleSetSha256([a, b])).toBe(
      new Bun.CryptoHasher("sha256").update(`${a}\n${b}\n`).digest("hex"),
    );
    expect(bundleSetSha256([])).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
